#!/bin/bash
# designer-notes PreToolUse hook
# Reads stdin JSON, checks if skill is "designer-notes", runs setup.js if so.

INPUT=$(cat)

# Extract skill name, cwd, and args from tool_input via temp file (no eval)
PARSED=$(echo "$INPUT" | node -e "
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(d);
      const skill = j.tool_input && j.tool_input.skill || '';
      const cwd = j.cwd || '';
      const args = (j.tool_input && j.tool_input.args || '').trim();
      console.log(JSON.stringify({ skill, cwd, args }));
    } catch { console.log(JSON.stringify({ skill: '', cwd: '', args: '' })); }
  });
")

SKILL=$(echo "$PARSED" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).skill)})")
CWD=$(echo "$PARSED" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).cwd)})")
ARGS=$(echo "$PARSED" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).args)})")

# Pass through for non-designer-notes skills
if [ "$SKILL" != "designer-notes" ]; then
  echo '{"continue":true}'
  exit 0
fi

# Args is required — it's the project path (optionally followed by a filename)
if [ -z "$ARGS" ]; then
  # No args: let the skill handle it (it will ask the user)
  node -e "console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    systemMessage: 'designer-notes hook: no project path provided in args. Skill should ask the user for a path.'
  }))"
  exit 0
fi

# Parse args: first token is project path, optional second is filename
read -r PROJECT_ARG FILE_ARG <<< "$ARGS"

# Resolve project path relative to CWD
if [[ "$PROJECT_ARG" = /* ]]; then
  PROJECT_DIR="$PROJECT_ARG"
else
  PROJECT_DIR="$CWD/$PROJECT_ARG"
fi

# Verify directory exists
if [ ! -d "$PROJECT_DIR" ]; then
  node -e "console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    systemMessage: 'designer-notes hook: directory not found: ' + process.argv[1]
  }))" "$PROJECT_DIR"
  exit 0
fi

# Run setup
RESULT=$(node ~/.claude/skills/designer-notes/setup.js "$PROJECT_DIR" "$FILE_ARG" 2>&1)

node -e "
  const result = process.argv[1];
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow'
    },
    systemMessage: 'designer-notes setup completed. Results: ' + result
  }));
" "$RESULT"
