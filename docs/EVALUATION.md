# Evaluation Record

Measured on 2026-11-12.

Commands:

```powershell
npm test
npm run eval
```

## Mapping Gates

| Case set | Cases | Result |
| --- | ---: | ---: |
| Standard CRM headers | 8 | PASS |
| Top-1 canonical field accuracy | 8 | 100% |
| Automated tests | 10 | 10/10 |

The evaluation set includes:

- Standard onboarding headers.
- Salesforce-style account fields.
- HubSpot-style contact fields.
- Chinese column names.
- Partial and ambiguous headers.

## Product Checks

- Required destinations are enforced.
- Duplicate destinations block approval.
- Invalid email counts appear in readiness.
- Duplicate customer IDs appear in the review queue.
- PII columns are detected and masked.
- Raw rows are excluded from live model requests.

## What This Does Not Prove

- It does not prove production accuracy for every customer schema.
- It does not benchmark live model mapping quality against deterministic mapping.
- It does not test files larger than the demo limits.
- It does not test CRM write behavior or rollback.

## Next Evaluation Layer

1. Add synthetic files with hostile headers and mixed languages.
2. Add table-driven transformation fixtures.
3. Compare deterministic, embedding, and LLM-assisted mapping.
4. Measure reviewer correction time with real FDE workflows.
5. Test dry-run imports against a mock CRM sandbox.
