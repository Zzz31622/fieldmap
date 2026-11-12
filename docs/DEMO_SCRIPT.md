# Interview Demo Script

Keep the walkthrough under four minutes.

## 1. Frame

"This is FieldMap, a customer data onboarding workbench. It covers the last mile from a customer CSV to a reviewed CRM mapping plan."

## 2. Source Profile

Point out:

- Nine inferred source fields.
- Masked PII samples.
- Local processing notice.

## 3. Mapping

Open `Schema mapping`.

Mention:

- Source-to-CRM fields.
- Confidence values.
- Human override dropdowns.
- Deterministic transformations.

Change one destination to `Ignore column`, show the readiness impact, then reset the sample.

## 4. Preview

Open `Preview`.

State: "The preview shows normalized output with PII masked."

## 5. Quality

Point to:

- One malformed email.
- One duplicate customer ID.
- Four PII fields.
- Readiness score of 83.

## 6. Handoff

Open `Handoff`.

State: "The export is implementation evidence, not raw customer data."

## 7. Verification

```powershell
npm test
npm run eval
```

Close with:

"The important design choice is local-first processing. Raw rows never go to the model. The optional model only sees column metadata, and its output still passes deterministic validation."
