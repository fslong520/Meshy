import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// 普通的代码标签组件 (处理高亮和内联样式)
export function CodeBlock({ node, className, children, ...props }: any) {
    // 这里只需返回 code 标签，不再包含 pre 包装
    return (
        <code className={className} {...props}>
            {children}
        </code>
    )
}

// 专门处理 pre 块的组件 (管理复制按钮)
export function PreBlock({ children }: any) {
    const [copied, setCopied] = useState(false)

    // 从 React Element 递归提取纯文本
    const getText = (node: any): string => {
        if (typeof node === 'string') return node
        if (node instanceof Array) return node.map(getText).join('')
        if (node?.props?.children) return getText(node.props.children)
        return ''
    }

    const onCopy = () => {
        const text = getText(children).replace(/\n$/, '')
        if (!text) return
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }

    // 处理阈值：判断是否为“大块”代码。
    // 这里我们判断代码内容超过 2 行，或者字符数超过 40
    const codeText = getText(children)
    const lineCount = codeText.trim().split('\n').length
    const isBig = lineCount >= 2 || codeText.length > 40

    return (
        <div className="code-block-wrapper">
            {isBig && (
                <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={onCopy} title="Copy code">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
            )}
            <pre>
                {children}
            </pre>
        </div>
    )
}
