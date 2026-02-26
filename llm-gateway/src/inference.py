from __future__ import annotations

import os
from typing import Optional
from openai import OpenAI

class LLMClient:
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.client = OpenAI(
            api_key=api_key or os.getenv("OPENAI_API_KEY"),
            base_url=base_url,
        )

    def answer(
        self,
        model: str,
        system_query: str,
        user_query: str,
        temperature: float = 0.2,
        max_tokens: int = 512,
    ) -> str:
        completion = self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "developer", "content": system_query},
                {"role": "user", "content": user_query},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return completion.choices[0].message.content or ""