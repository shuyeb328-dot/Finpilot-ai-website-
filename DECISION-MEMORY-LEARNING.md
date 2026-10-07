# FinPilot AI 2.7 — Decision Memory & Learning

FinPilot now evaluates decisions against recorded outcomes.

## Learning loop
1. Store recommendation and agent.
2. Record the eventual outcome.
3. Classify outcome as SUCCESS, POSITIVE, IMPROVED, NEGATIVE, MISSED, or FAILED.
4. Track agent outcome performance.
5. Detect repeated error tags.
6. Calculate a bounded confidence adjustment (-15 to +10).
7. Feed the adjustment into future Round Table confidence.

Learning is advisory. It does not execute financial transactions and does not replace user approval.
