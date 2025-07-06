from fastapi import FastAPI
from pydantic import BaseModel
from groq import Groq
import uvicorn
import json

app = FastAPI()

# Initialize Groq client
client = Groq(api_key="")

class CodeSnippet(BaseModel):
    code: str

def preprocess_code(code):
    return code.strip()

@app.post("/analyze")
async def analyze_code(snippet: CodeSnippet):
    code = preprocess_code(snippet.code)

    # Prompt Groq to return structured JSON matching exact schema
    prompt = (
        "You are a secure code analysis assistant. Analyze the following Python code and respond ONLY in the following exact JSON format:\n\n"
        "If vulnerability is found:\n"
        "{\n"
        "  \"status\": \"vulnerabilities found\",\n"
        "  \"context\": \"<short description of what the code does>\",\n"
        "  \"report\": \"<description of the vulnerability>\",\n"
        "  \"suggested_fix\": \"<how to fix it>\",\n"
        "  \"vulnerable_line\": <line number>,\n"
        "  \"severity\": \"low|medium|high\"\n"
        "}\n\n"
        "If no vulnerability is found:\n"
        "{\n"
        "  \"status\": \"no vulnerabilities found\",\n"
        "  \"context\": \"<summary of code>\",\n"
        "  \"report\": \"No issues detected.\",\n"
        "  \"suggested_fix\": null,\n"
        "  \"vulnerable_line\": null,\n"
        "  \"severity\": null\n"
        "}\n\n"
        f"Code:\n{code}"
    )

    completion = client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        max_completion_tokens=512,
        top_p=1,
        stream=False,
    )

    raw_output = completion.choices[0].message.content

    try:
        parsed_output = json.loads(raw_output)
    except json.JSONDecodeError:
        parsed_output = {
            "status": "error",
            "context": None,
            "report": "Failed to parse model output as JSON.",
            "suggested_fix": None,
            "vulnerable_line": None,
            "severity": None,
            "raw": raw_output
        }

    return parsed_output

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
