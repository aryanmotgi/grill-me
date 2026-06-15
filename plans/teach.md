# Teach helper

After Codex ships a diff, walk user through it.

Steps:
1. `git diff --stat` — show scope
2. For each changed file:
   - One sentence: what file does
   - One sentence: what new code added
   - One sentence: the *mechanism* (why it works)
3. Pick one non-obvious line. Ask: "what happens if <edge case>?"
4. If user can't answer, explain. Re-ask different edge case.
5. Loop until user can predict behavior without looking

Goal: user can defend the code as their own.
