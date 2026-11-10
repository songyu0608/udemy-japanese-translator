# Dictionary

## Requirements
- Developer terms listed in the dictionary stay in English in the Japanese translation, exactly as written in the source (casing and plural kept)
- Scope: Claude / Anthropic, the CCAR-F exam domains (agentic architecture, tool design and MCP, Claude Code, prompt engineering, context management), AWS services, AWS concepts, and general development terms
- Technical words that appear in exam text, such as "deterministic" and "session", stay in English; ordinary English words ("continue", "summary", "attention") are still translated
- The longest matching term wins ("AWS Lambda function" over "AWS Lambda")
- Acronyms (no lowercase letters) and terms marked "case-sensitive" match only with exact casing, so ordinary words are still translated ("Sam", "lag", "haiku")
- A term inside another word is not matched ("subnetwork" is not "subnet")
- Each term is one row: a word, an optional Japanese meaning, and an optional case-sensitive flag
- A term with a meaning is replaced with that meaning in the translation. The English word does not appear in the Japanese text
- A term without a meaning stays in English
- A term also matches its plural ("private subnets" uses the meaning of "private subnet")
- If the dictionary cannot be applied safely, the text is still translated without it; a translation is never left broken

Example (term without meaning):
- Input: "Attach an IAM role to the AWS Lambda function in a private subnet."
- Result: Japanese sentence where `IAM role`, `AWS Lambda function` stay English

Example (term with meaning):
- Input: "Create a private subnet for the VPC." with a row `private subnet` → `プライベートサブネット`
- Result: Japanese sentence where `private subnet` is replaced by `プライベートサブネット`

- Design: [Dictionary Design](../../design/translation/20-dictionary.md#placeholder-substitution)
