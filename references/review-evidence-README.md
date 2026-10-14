# .review-evidence/ Directory

This directory is automatically created by the MVP Adversarial Review Loop skill and contains all reproduction code and evidence from the review process.

## Purpose

- **Auditability**: Complete trace of every finding with executable reproduction code
- **Reproducibility**: Any agent or human can re-run the exact counterexample that triggered a fix
- **Traceability**: Links findings → reproduction → test → commit → verification

## Structure

```
.review-evidence/
├── baseline.md                          # Review baseline: scope, tech stack, test commands
├── round-1/
│   ├── SEC-001/
│   │   ├── reproduce.test.js            # Original reproduction code from review agent
│   │   ├── counterexample.md            # Text description: preconditions, steps, expected/actual
│   │   ├── challenge-result.md          # Challenge agent's verification (if triggered)
│   │   └── verification-result.md       # Final verification agent's result
│   └── FUNC-002/
│       ├── reproduce.sh                 # Script-based reproduction
│       └── output.log                   # Actual execution output
└── round-2/
    └── ...
```

## Lifecycle

1. **Main agent** creates `round-N/` directory at the start of each review round
2. **Review agents** create `[finding_id]/` subdirectories and write reproduction code
3. **Main agent** runs reproduction code during adjudication to verify the issue
4. **Implementation agent** uses reproduction code for RED phase of TDD
5. **Verification agent** re-runs reproduction code to confirm the fix
6. **User** can inspect any reproduction code to understand what was found and how it was verified

## Git Policy

This directory **should be committed** to version control to maintain an audit trail. The `.gitignore` file should NOT exclude `.review-evidence/`.

## Manual Usage

To reproduce a finding manually:

```bash
# Navigate to the finding directory
cd .review-evidence/round-1/SEC-001/

# Run the reproduction (adjust command based on file type)
node reproduce.test.js          # For JavaScript tests
./reproduce.sh                  # For shell scripts
pytest reproduce.test.py        # For Python tests
cat manual-steps.md            # For manual reproduction steps
```

## Cleanup

Do not delete this directory unless:
- The entire review loop is cancelled and you want to start fresh
- The project is abandoned

Even after fixes are complete, this directory serves as historical evidence of what was reviewed and how issues were verified.
