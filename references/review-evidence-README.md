# .review-evidence/ Directory

This directory is automatically created by the MVP Adversarial Review Loop skill and contains all reproduction code and evidence from the review process.

## Purpose

- **Auditability**: Complete trace of every finding with executable reproduction code
- **Reproducibility**: Any agent or human can re-run the exact counterexample that triggered a fix
- **Traceability**: Links findings → reproduction → test → commit → verification

## Structure

```
.review-evidence/
├── README.md                            # This file
├── baseline.md                          # Review baseline: scope, tech stack, test commands
├── findings-index.md                    # Global index of all findings across rounds
├── round-1/
│   ├── R1-F001-SEC/                     # Standard ID (renamed from SEC-001)
│   │   ├── original-id.txt              # Content: SEC-001
│   │   ├── reproduce.test.js            # Original reproduction code from review agent
│   │   ├── counterexample.md            # Text description: preconditions, steps, expected/actual
│   │   ├── adjudication.md              # Main agent's adjudication record
│   │   ├── challenge-result.md          # Challenge agent's verification (if triggered)
│   │   └── verification-result.md       # Final verification agent's result
│   └── R1-F002-FUNC/                    # Renamed from FUNC-001
│       ├── original-id.txt              # Content: FUNC-001
│       ├── reproduce.sh                 # Script-based reproduction
│       ├── counterexample.md            # Text description
│       ├── adjudication.md              # Adjudication record
│       └── output.log                   # Actual execution output
└── round-2/
    ├── R2-F003-PERF/                    # Global sequence continues (not R2-F001)
    └── ...
```

## Finding ID Format

All findings use the standard ID format: `R[round]-F[sequence]-[category]`

- **R[round]**: Review round number (R1, R2, etc.)
- **F[sequence]**: Global sequence number (001, 002, etc.) - increments across rounds
- **[category]**: Category code (SEC, FUNC, REL, API, PERF, UX, OPS, PROD)

Review agents initially create directories with temporary IDs (e.g., `SEC-001`), but the main agent immediately renames them to standard IDs during adjudication. The `original-id.txt` file preserves the review agent's temporary ID for traceability.

## Lifecycle

1. **Main agent** creates `round-N/` directory at the start of each review round
2. **Review agents** create `[temporary_id]/` subdirectories (e.g., `SEC-001/`) and write reproduction code
3. **Main agent** during adjudication:
   - Performs rationality check on the counterexample
   - Assigns standard ID (e.g., `R1-F001-SEC`)
   - Renames directory from temporary ID to standard ID
   - Saves original ID in `original-id.txt`
   - Runs reproduction code to verify the issue
   - Writes adjudication record in `adjudication.md`
   - Updates `findings-index.md`
4. **Implementation agent** uses reproduction code (via standard ID path) for RED phase of TDD
5. **Verification agent** re-runs reproduction code (via standard ID path) to confirm the fix
6. **User** can inspect any reproduction code to understand what was found and how it was verified

## Git Policy

This directory **should be committed** to version control to maintain an audit trail. The `.gitignore` file should NOT exclude `.review-evidence/`.

## Manual Usage

To reproduce a finding manually:

```bash
# Navigate to the finding directory (use standard ID)
cd .review-evidence/round-1/R1-F001-SEC/

# Check the original review agent's ID
cat original-id.txt  # Shows: SEC-001

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
