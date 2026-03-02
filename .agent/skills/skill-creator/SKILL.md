---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill quality. Use this skill whenever the user wants to create a skill from scratch, update or optimize an existing skill, turn a current workflow into a reusable skill, or discuss best practices for skill design. Make sure to use this skill even if the user just mentions "creating", "making", "building", or "adding" a new skill, or says things like "turn this into a skill" or "can we save this as a workflow".
keywords: ["system", "meta", "creator", "prompt-engineering", "skill", "workflow"]
---

# Skill Creator

A skill for creating new skills and iteratively improving them.

At a high level, the process goes like this:

1. Decide what the skill should do and roughly how it should work
2. Write a draft of the SKILL.md
3. Test the skill manually on a few realistic prompts
4. Evaluate results with the user — qualitatively and (if applicable) quantitatively
5. Rewrite the skill based on feedback
6. Repeat until the user is satisfied

Your job is to figure out where the user is in this process and help them move forward. Maybe they say "I want a skill for X" — you help narrow it down, draft it, and iterate. Or maybe they already have a draft — you jump straight to evaluation and improvement.

Be flexible. If the user says "I don't need to run evaluations, just vibe with me", do that instead.

---

## Communicating with the User

Pay attention to context cues to understand the user's familiarity level. Technical users might be comfortable with terms like "frontmatter" and "assertion". Non-technical users might need gentler framing.

Default guidelines:
- "evaluation" and "benchmark" are borderline, but OK
- For "JSON", "assertion", "frontmatter" — briefly explain if you're unsure the user knows them
- It's always OK to briefly define a term ("assertions — specific checkable claims about the output")
- Prefer plain language over jargon, but don't dumb things down for clearly technical users

---

## Creating a Skill

### Step 1: Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture — e.g., they say "turn this into a skill". If so, extract answers from the conversation history first: the tools used, the sequence of steps, corrections the user made, input/output formats observed.

Key questions to answer (interview, don't interrogate — skip any that are already obvious):

1. **What should this skill enable the AI to do?** Get a clear picture of the goal.
2. **When should this skill trigger?** What user phrases or contexts should activate it?
3. **What's the expected output format?** Files, text, structured data?
4. **Are there specific tools or dependencies?** MCP servers, scripts, APIs?
5. **Should we set up test cases?** Skills with objectively verifiable outputs (file transforms, code generation, fixed workflows) benefit from tests. Skills with subjective outputs (writing style, creative work) usually don't.

### Step 2: Interview and Research

Proactively ask about:
- Edge cases and failure modes
- Input/output formats and example files
- Success criteria — how does the user know it worked?
- Dependencies — external APIs, specific file types, installed tools

Check available tools and MCPs — if they're useful for research (searching docs, finding similar patterns), use them. Come prepared with context so the user doesn't have to explain everything.

Don't start writing until you've ironed out the requirements. A 5-minute conversation saves hours of iteration.

### Step 3: Write the SKILL.md

Based on the interview, write the skill file at `.agent/skills/<skill-name>/SKILL.md`.

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata** (name + description) — Always in context (~100 words max)
2. **SKILL.md body** — Loaded when the skill triggers (<500 lines ideal)
3. **Bundled resources** — Loaded on demand (unlimited; scripts execute without loading)

Key patterns:
- Keep SKILL.md under 500 lines. If it gets longer, move detail into `references/` files with clear pointers.
- For large reference files (>300 lines), include a table of contents.
- When a skill covers multiple domains, organize by variant:

```
cloud-deploy/
├── SKILL.md (workflow + selection logic)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

The AI reads only the relevant reference file based on context.

#### YAML Frontmatter

The frontmatter is the skill's identity and primary triggering mechanism.

```yaml
---
name: kebab-case-name
description: What it does AND when to use it. Be slightly pushy to prevent under-triggering.
keywords: ["keyword1", "keyword2"]
---
```

**Writing the `description` field:**

The description determines whether the AI invokes this skill. Include both what the skill does AND specific contexts for when to use it.

> [!IMPORTANT]
> Today's AI models tend to **under-trigger** skills — they often don't use them even when they'd be helpful. To combat this, make descriptions slightly "pushy". Instead of just describing what the skill does, explicitly list the kinds of user requests that should activate it.

**Bad:** "How to build a dashboard to display data."
**Good:** "How to build a fast dashboard to display data. Use this skill whenever the user mentions dashboards, data visualization, metrics, charts, or wants to display any kind of data, even if they don't explicitly ask for a 'dashboard'."

#### Writing Style

- **Use imperative form.** "Generate the report" not "The report should be generated".
- **Explain the why.** Instead of hammering ALWAYS/NEVER rules, explain reasoning so the AI understands the intent and can generalize.
- **Start with a defining statement.** "You are an expert at..." or "This skill handles..."
- **Use examples.** Show concrete input → output pairs.
- **Avoid over-specification.** Don't micromanage every step. AI models are smart and can fill in reasonable gaps when they understand the goal.

**Defining output formats:**
```markdown
## Report Structure
ALWAYS use this template:
# [Title]
## Executive Summary
## Key Findings
## Recommendations
```

**Including examples:**
```markdown
## Commit Message Format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

#### Principle of No Surprise

Skills must not contain malware, exploit code, or anything that could compromise security. A skill's contents should never surprise the user in their intent. Don't create misleading skills or skills designed for unauthorized access. Creative/roleplay skills are fine.

---

## Editing Existing Skills

If the user asks to modify an existing skill:

1. **Read the current SKILL.md** using your file reading tools
2. **Understand the intent** — what's working and what isn't?
3. **Suggest specific changes** — don't just rewrite blindly
4. **Get user approval** before overwriting
5. **Rewrite the file** only after the user confirms

When improving, think about:
- Is the description triggering correctly? Maybe it's too narrow or too broad.
- Are there missing edge cases?
- Could bundled scripts replace repetitive manual steps?
- Is the prompt lean? Remove things that aren't pulling their weight.

---

## Improving a Skill

This is the heart of working with existing skills.

### How to Think About Improvements

1. **Generalize from feedback.** Skills will be used across many different prompts. If you and the user are iterating on specific examples, make sure changes generalize. Rather than adding fiddly, overfitting rules, try different metaphors or recommend different patterns.

2. **Keep the prompt lean.** Remove instructions that aren't pulling their weight. If the AI is wasting time on unproductive steps, cut the parts causing that.

3. **Explain the why.** Try hard to explain the reasoning behind every instruction. Today's AI models are smart — when given good context about *why* something matters, they generalize beyond rote instructions. If you find yourself writing ALWAYS/NEVER in all caps, that's a yellow flag. Reframe with reasoning instead.

4. **Look for repeated work.** If every test run independently writes the same helper script or takes the same multi-step approach, that's a strong signal to bundle that script into the skill's `scripts/` directory.

### The Iteration Loop

After improving a skill:

1. Apply improvements to the SKILL.md
2. Test manually with a few realistic prompts
3. Ask the user to try it and report back
4. Adjust based on feedback

Keep going until:
- The user says they're happy
- Feedback is consistently positive
- You're not making meaningful progress

---

## Test Cases (Optional but Recommended)

For skills with objectively verifiable outputs, create simple test cases:

1. Draft 2-3 realistic prompts — the kind of thing a real user would actually say
2. Share with the user: "Here are a few test cases I'd like to try. Do these look right?"
3. Save them to `evals/evals.json` within the skill directory:

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's realistic task prompt",
      "expected_output": "Description of what a good result looks like",
      "files": []
    }
  ]
}
```

4. Run each test prompt manually, then compare output with the expected result
5. Iterate on the skill based on what you find

---

## Reference Files

This skill's bundled resources:

- **This file** (`SKILL.md`) — The main instructions you're reading now
- Skills you create may include their own `scripts/`, `references/`, and `assets/` directories

---

**Core loop reminder:**

1. Figure out what the skill is about
2. Draft or edit the SKILL.md
3. Test on realistic prompts
4. With the user, evaluate the outputs
5. Improve and repeat until satisfactory

Good luck!
