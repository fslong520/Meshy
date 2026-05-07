#!/usr/bin/env python3
"""
ERNIE-4.5-0.3B 意图分类推理服务器（子进程模式）

======================================================
本脚本专为 Meshy 多智能体编排框架设计，
在 openKylin 上以子进程方式运行，通过 stdin/stdout
与 Node.js 宿主进程通信，实现轻量级意图分类。

使用方式（由 Node.js 自动管理，不必手动启动）：
  python3 ernie_intent_server.py

通信协议：
  输入（stdin，每行一个 JSON）：
    {"id":"req_001","text":"用户的输入文本","categories":[...]}
  输出（stdout，每行一个 JSON）：
    {"id":"req_001","intent":"code_edit","confidence":0.85,"reasoning":"..."}

设计要点：
  - 进程常驻，模型只加载一次，后续请求复用
  - 专为意图分类优化生成参数（极少 token 生成，速度优先）
  - 显存不足时自动回退到 CPU
  - 内置健康检查/心跳机制
  - 兼容非 ERNIE 环境：当模型不可用时自动降级为规则匹配输出
"""

import sys
import json
import os
import traceback

# ─── 意图分类模板 ───
# 用中文描述每个意图类别，使 ERNIE（中文优化模型）能准确理解
INTENT_CATEGORIES = {
    "code_edit": "修改、重构或修复已有代码",
    "code_search": "在代码库中搜索符号、定义或文件位置",
    "code_generate": "从头创建新代码文件或新模块",
    "debug": "分析报错信息、排查 Bug、修复运行时问题",
    "explain": "解释代码逻辑、技术概念或系统原理",
    "general_chat": "日常对话、闲聊、非技术性话题",
    "info_retrieval": "从外部来源（网络、文档、数据库）检索信息",
    "task_planning": "复杂任务的拆解、架构设计、步骤规划",
}

CLASSIFY_SYSTEM_PROMPT = """你是一个精确的意图分类器。请将用户输入分类到以下类别之一：

{category_desc}

请严格按照以下 JSON 格式输出（不要附加任何额外文本）：
{{"intent":"类别名称","confidence":0.xx,"reasoning":"一句话理由"}}

其中 confidence 为 0~1 之间的浮点数，代表你对分类的把握程度。
reasoning 用简洁的中文说明分类依据。"""


# ─── 模型管理 ───

class ErnieIntentClassifier:
    """封装 ERNIE-4.5-0.3B 模型，专用于意图分类"""

    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.model_name = "PaddlePaddle/ERNIE-4.5-0.3B-PT"
        self.is_loaded = False
        self.load_error = None

    def load(self):
        """加载模型（首次请求时懒加载）"""
        if self.is_loaded:
            return True

        try:
            import torch
            from modelscope import AutoModelForCausalLM, AutoTokenizer

            print(f"[ERNIE] Loading model {self.model_name}...", file=sys.stderr)

            self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)

            # 检测是否有可用的 GPU
            if torch.cuda.is_available():
                print(f"[ERNIE] GPU detected: {torch.cuda.get_device_name(0)}", file=sys.stderr)
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_name,
                    device_map="auto",
                    dtype=torch.bfloat16,
                )
            else:
                print("[ERNIE] No GPU detected, falling back to CPU.", file=sys.stderr)
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_name,
                    device_map="cpu",
                    torch_dtype=torch.float32,
                )

            self.is_loaded = True
            print("[ERNIE] Model loaded successfully.", file=sys.stderr)
            return True

        except Exception as e:
            self.load_error = str(e)
            print(f"[ERNIE] Failed to load model: {e}", file=sys.stderr)
            print("[ERNIE] Will use rule-based fallback classification.", file=sys.stderr)
            return False

    def classify(self, text: str) -> dict:
        """
        对用户输入进行意图分类

        返回: {"intent": str, "confidence": float, "reasoning": str}
        """
        if not self.is_loaded:
            return self._fallback_classify(text)

        try:
            category_lines = "\n".join(
                [f"- {k}: {v}" for k, v in INTENT_CATEGORIES.items()]
            )
            system_prompt = CLASSIFY_SYSTEM_PROMPT.format(category_desc=category_lines)

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ]

            formatted = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )

            model_inputs = self.tokenizer(
                [formatted],
                add_special_tokens=False,
                return_tensors="pt",
            ).to(self.model.device)

            import torch
            model_inputs = self.tokenizer(
                [formatted],
                add_special_tokens=False,
                return_tensors="pt",
            ).to(self.model.device)

            with torch.no_grad():
                generated_ids = self.model.generate(
                    **model_inputs,
                    max_new_tokens=64,         # 分类不需要太多 token
                    min_new_tokens=4,
                    temperature=0.1,            # 低温度确保确定性输出
                    top_p=0.9,
                    do_sample=False,
                    pad_token_id=self.tokenizer.eos_token_id,
                )

            output_ids = generated_ids[0][len(model_inputs.input_ids[0]):].tolist()
            raw_output = self.tokenizer.decode(output_ids, skip_special_tokens=True).strip()

            # 解析 JSON 输出
            return self._parse_output(raw_output, text)

        except Exception as e:
            print(f"[ERNIE] Classification inference failed: {e}", file=sys.stderr)
            return self._fallback_classify(text)

    def _parse_output(self, raw: str, original_text: str) -> dict:
        """从模型输出中提取结构化分类结果"""
        # 尝试直接解析 JSON
        import re
        json_match = re.search(r'\{[^}]+\}', raw)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
                intent = parsed.get("intent", "")
                confidence = float(parsed.get("confidence", 0.5))
                reasoning = parsed.get("reasoning", "")
                if intent in INTENT_CATEGORIES:
                    return {
                        "intent": intent,
                        "confidence": min(max(confidence, 0.0), 1.0),
                        "reasoning": reasoning or "classified by ERNIE-0.3B",
                    }
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

        # JSON 解析失败，用关键词兜底
        return self._fallback_classify(original_text)

    def _fallback_classify(self, text: str) -> dict:
        """
        纯关键词兜底分类（无需模型加载）。
        与 Meshy 现有 IntentRouter 的关键词逻辑一致。
        """
        text_lower = text.lower()

        rules = [
            (["重构", "refactor", "修改", "edit", "改一下", "替换", "replace", "修复", "fix", "优化"],
             "code_edit", 0.6),
            (["搜索", "search", "找到", "find", "grep", "定位", "locate", "哪里"],
             "code_search", 0.6),
            (["生成", "generate", "创建", "create", "新建", "新增", "scaffold", "写一个"],
             "code_generate", 0.6),
            (["报错", "error", "bug", "崩溃", "crash", "调试", "debug", "排查", "为什么"],
             "debug", 0.7),
            (["解释", "explain", "什么意思", "为何", "原理", "怎么工作", "是什么"],
             "explain", 0.6),
            (["计划", "plan", "拆解", "任务", "设计", "架构", "design", "architect"],
             "task_planning", 0.7),
            (["爬虫", "crawl", "新闻", "news", "查询", "query", "搜一下", "网上", "搜索一下"],
             "info_retrieval", 0.6),
        ]

        best_intent = "general_chat"
        best_score = 0
        best_reason = "未匹配到特定意图关键词"

        for keywords, intent, base_conf in rules:
            score = sum(1 for kw in keywords if kw in text_lower)
            if score > best_score:
                best_score = score
                best_intent = intent
                best_reason = f"命中关键词: {[kw for kw in keywords if kw in text_lower]}"

        confidence = min(best_score * 0.25, 0.8) if best_score > 0 else 0.15
        return {
            "intent": best_intent,
            "confidence": confidence,
            "reasoning": best_reason if best_score > 0 else "无明确关键词匹配，归为 general_chat",
        }

    def chat(self, text: str, max_new_tokens: int = 512) -> dict:
        """
        用本地模型生成文本回复（兜底生成模式）。
        当所有远程 API 都不可用时，由本地小模型直接回复用户。

        返回: {"response": str, "model": "ernie-0.3b-local", "tokens": int}
        """
        if not self.is_loaded:
            return {
                "response": "[本地模型未加载。请配置 API Key 或等待模型加载完成。]",
                "model": "ernie-0.3b-local",
                "tokens": 0,
            }

        try:
            messages = [
                {"role": "user", "content": text},
            ]

            formatted = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )

            import torch
            model_inputs = self.tokenizer(
                [formatted],
                add_special_tokens=False,
                return_tensors="pt",
            ).to(self.model.device)

            with torch.no_grad():
                generated_ids = self.model.generate(
                    **model_inputs,
                    max_new_tokens=max_new_tokens,
                    temperature=0.7,
                    top_p=0.9,
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id,
                )

            output_ids = generated_ids[0][len(model_inputs.input_ids[0]):].tolist()
            response_text = self.tokenizer.decode(output_ids, skip_special_tokens=True).strip()

            return {
                "response": response_text or "[模型未生成有效回复]",
                "model": "ernie-4.5-0.3b-local",
                "tokens": len(output_ids),
            }

        except Exception as e:
            return {
                "response": f"[本地模型回复出错: {e}]",
                "model": "ernie-4.5-0.3b-local",
                "tokens": 0,
            }

    def health_check(self) -> dict:
        """返回模型健康状态"""
        return {
            "loaded": self.is_loaded,
            "model": self.model_name,
            "error": self.load_error,
            "categories": list(INTENT_CATEGORIES.keys()),
        }

    def unload(self):
        """释放模型资源"""
        if self.model is not None:
            del self.model
            self.model = None
        if self.tokenizer is not None:
            del self.tokenizer
            self.tokenizer = None
        self.is_loaded = False
        print("[ERNIE] Model unloaded.", file=sys.stderr)


# ─── 主循环（stdin/stdout JSON-RPC 风格通信）───

def main():
    """
    主事件循环：
    从 stdin 读取 JSON 请求 → 处理 → 输出 JSON 结果到 stdout
    """
    classifier = ErnieIntentClassifier()

    # 首次请求到来时再加载模型（懒加载）
    # 这样即使模型加载失败，fallback 也能工作

    print("[ERNIE] Intent classification server ready.", file=sys.stderr)
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            # 非 JSON 格式则忽略
            continue

        req_id = request.get("id", "unknown")
        mode = request.get("mode", "classify")

        if mode == "classify":
            text = request.get("text", "")
            if not text:
                response = {
                    "id": req_id,
                    "error": "Missing 'text' field",
                    "intent": "unknown",
                    "confidence": 0.0,
                    "reasoning": "no input text provided",
                }
            else:
                # 确保模型已加载（懒加载）
                classifier.load()
                result = classifier.classify(text)
                response = {
                    "id": req_id,
                    **result,
                }

        elif mode == "chat":
            text = request.get("text", "")
            max_tokens = request.get("max_tokens", 512)
            if not text:
                response = {
                    "id": req_id,
                    "error": "Missing 'text' field",
                    "response": "",
                    "model": "ernie-4.5-0.3b-local",
                    "tokens": 0,
                }
            else:
                classifier.load()
                result = classifier.chat(text, max_tokens)
                response = {
                    "id": req_id,
                    "type": "chat",
                    **result,
                }

        elif mode == "health":
            response = {
                "id": req_id,
                "type": "health",
                **classifier.health_check(),
            }

        elif mode == "unload":
            classifier.unload()
            response = {
                "id": req_id,
                "type": "unloaded",
            }

        elif mode == "ping":
            response = {
                "id": req_id,
                "type": "pong",
            }

        else:
            response = {
                "id": req_id,
                "error": f"Unknown mode: {mode}",
            }

        # 输出结果（每行一个完整的 JSON 对象）
        print(json.dumps(response, ensure_ascii=False))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
