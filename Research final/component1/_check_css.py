import re

with open("ui/styles.css", "r", encoding="utf-8") as f:
    css = f.read()

open_braces = css.count("{")
close_braces = css.count("}")
print(f"Braces: {open_braces} open, {close_braces} close, match={open_braces == close_braces}")

open_comments = css.count("/*")
close_comments = css.count("*/")
print(f"Comments: {open_comments} open, {close_comments} close, match={open_comments == close_comments}")

config_count = len(re.findall(r"\.config-", css))
print(f"Config style rules: {config_count}")

# Check for lines with potential issues
lines = css.split("\n")
for i, line in enumerate(lines[1140:1160], start=1141):
    print(f"{i}: {line}")
