---
name: strict-tdd
description: Production-grade Strict Test-Driven Development (TDD) Protocol. Forces Red-Green-Refactor pipeline.
keywords: ["tdd", "test", "测试驱动", "coverage", "red-green-refactor", "jest", "vitest"]
---

# 🛡️ Strict TDD (Test-Driven Development) Protocol

## 🎯 Protocol Objective
You are operating under the **Strict TDD Protocol**. This means you are strictly forbidden from writing ANY production implementation code before you have written a failing test that explicitly validates the desired behavior. Your workflow must follow the immutable Red-Green-Refactor paradigm.

## 🔄 The Red-Green-Refactor Pipeline

### Phase 1: 🔴 RED (Write Failing Test)
1. **Analyze Requirements**: Deeply understand the user's request. Identify the boundary conditions, edge cases, and core success criteria.
2. **Draft the Test**: Navigate to the appropriate test file (e.g., `*.test.ts`, `*.spec.ts`) or create one if it does not exist.
3. **Write the Assertion**: Write a test that strictly asserts the *new* behavior. Do NOT write tests for things that are out of scope.
4. **Execute and Verify Failure**: You MUST execute the test suite to prove that the test fails. The failure must be due to the missing implementation (e.g., `ReferenceError`, `AssertionError`), not a syntax error in your test.
   - *Output Requirement*: You must output `[🔴 RED PHASE] Test failed actively. Ready for implementation.` and briefly show the failure reason.

### Phase 2: 🟢 GREEN (Make it Pass)
1. **Minimal Implementation**: Switch to the target source file. Write the *absolute minimum* amount of code required to make the failing test pass. Do not over-engineer. Do not add speculative features.
2. **Execute and Verify Success**: Re-run the specific test or the test suite. Ensure the new test passes and no existing tests are broken.
   - *Output Requirement*: You must output `[🟢 GREEN PHASE] Implementation injected. All tests passing.`

### Phase 3: 🔵 REFACTOR (Clean Code)
1. **Code Smells Check**: Inspect the code you just wrote in the Green phase. Look for magic numbers, duplicated logic (DRY violations), poor naming conventions, and overly complex control flows.
2. **Safe Mutation**: Refactor the code to meet production-quality standards.
3. **Regression Check**: Re-run the test suite. Because you are covered by tests, you can refactor confidently.
   - *Output Requirement*: You must output `[🔵 REFACTOR PHASE] Code structure optimized.`

## 🛑 Strict Disciplinary Rules
- **ZERO Tolerance for Logic-First**: If you are caught writing business logic before the associated test is committed and verified to fail, you are violating your core directive.
- **Test Retry Circuit Breaker**: If you attempt to fix a failing test more than **2 times** consecutively without success, you MUST STOP. Output a `[🚨 BLOCKER]` message to the user explaining the mismatch (e.g., environment issue, fundamental design flaw) and wait for human intervention. DO NOT guess blindly.
- **Coverage Awareness**: Ensure your tests cover both the "Happy Path" and the predictable "Unhappy Paths" (e.g., null inputs, network timeouts, invalid state mutations).

By activating this skill, you agree to govern your exact sequence of file edits by this protocol without exception.
