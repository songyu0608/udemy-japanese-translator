# Dictionary Scenarios

## Dictionary Scenarios
- Design: [Dictionary Design](../../../design/translation/20-dictionary.md#placeholder-substitution)

### Protect and Restore
- Input: "Launch an EC2 instance in a private subnet with an IAM role."
- Steps: `protect()` → translate → `restore()`
- Result: Terms `EC2`, `instance`, `private subnet`, `IAM role` stay English
- Test: `tests/dictionary.test.js` → "replaces terms with placeholders and restores the original text"

### Longest Match
- Input: "Use AWS Lambda function URLs." / "Use AWS Lambda with an IAM role."
- Steps: `protect()`
- Result: `AWS Lambda function` and `URLs` in the first; `AWS Lambda` and `IAM role` in the second
- Test: "prefers the longest matching term"

### Plural and Casing
- Input: "Two Security Groups and three VPCs."
- Steps: `protect()`
- Result: `Security Groups`, `VPCs` kept as written
- Test: "keeps plural and original casing"

### Acronym Versus Ordinary Word
- Input: "Sam noticed lag after deploying with SAM."
- Steps: `protect()`
- Result: Only `SAM` is protected
- Test: "acronyms match case-sensitively"

### Case Sensitive Names
- Input: "I wrote a haiku about my projects." / "Claude Haiku in Projects"
- Steps: `protect()`
- Result: Nothing protected in the first; `Claude`, `Haiku`, `Projects` in the second
- Test: "case-sensitive names ignore lowercase words"

### No Match Inside Words
- Input: "The subnetwork is ok." / "Use SQSX now."
- Steps: `protect()`
- Result: Nothing protected
- Test: "does not match inside other words"

### Line Breaks
- Input: "Configure a  private" + newline + "subnet."
- Steps: `protect()`
- Result: The two-line `private subnet` is protected as one term
- Test: "matches terms across line breaks and extra spaces"

### CCAR-F Exam Terms
- Input: "Claude Code must block any Bash command during an agentic session. The enforcement must be deterministic; CLAUDE.md is applied deterministically at every session."
- Steps: `protect()`
- Result: `Claude Code`, `Bash command`, `agentic session`, `deterministic`, `CLAUDE.md`, `deterministically`, `session` stay English
- Test: "keeps CCAR-F exam terms in English"

### Ordinary Words Are Translated
- Input: "Read the file and continue with the next step. Pay attention to the summary."
- Steps: `protect()`
- Result: Nothing protected
- Test: "ordinary English verbs and nouns are still translated"

### Existing Placeholder Syntax
- Input: "Value [[0]] with an EC2 instance"
- Steps: `protect()`
- Result: Dictionary skipped, text unchanged
- Test: "leaves text with existing placeholder syntax untouched"

### Lost Placeholder
- Input: Translation "[[0]]だけ残る" for terms `EC2`, `S3`
- Steps: `restore()` returns `null` → `translateWithDictionary()` translates the plain source
- Result: A plain translation is shown, never a broken one
- Test: "restore returns null when a placeholder is lost"

### Extra Brackets From Translator
- Input: "[[[0]]で[[1]]]" (observed on Chrome 157)
- Steps: `restore()`
- Result: "Auto Scaling groupでEC2" with no stray brackets
- Test: "restore absorbs extra brackets added by the translator"

### Spacing and Repeats
- Input: "[[ 0 ]]と[[0]]"
- Steps: `restore()`
- Result: "S3とS3"
- Test: "restore accepts spacing inside brackets and repeated placeholders"

### Meaning Replaces Word
- Input: "Create a private subnet with lag." with rows `private subnet` → `プライベートサブネット`, `lag` → `遅延`
- Steps: `configure(rows)` → `protect()` → translate "Create a [[0]] with [[1]]." → `restore()` with meanings
- Result: Japanese text contains `プライベートサブネット` and `遅延`, not the English words
- Test: "pairs are replaced with their meaning"

### Meaning For Plural
- Input: "Two private subnets." with row `private subnet`
- Steps: `protect()`
- Result: Meaning `プライベートサブネット` is used for `private subnets`
- Test: "pair lookup accepts a plural of the listed word"

### Row Overrides Same Spelling
- Input: "a private subnet" with row `Private Subnet` (also a bundled group term)
- Steps: `protect()`
- Result: The meaning is used, not the English term
- Test: "a pair overrides a kept term with the same spelling"

### Kept Term Has No Meaning
- Input: "Launch an EC2 instance."
- Steps: `protect()` → `restore()` with meanings
- Result: `EC2 instance` restored in English
- Test: "kept terms have no meaning and restore to English"

### Acronym With Meaning
- Input: "Sam and SAM." with row `SAM`
- Steps: `protect()`
- Result: Only `SAM` is protected
- Test: "acronym pairs match case-sensitively"
