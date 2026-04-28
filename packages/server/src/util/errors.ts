export interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

export function openAiError(
  message: string,
  type: string,
  code: string,
): OpenAIErrorBody {
  return { error: { message, type, code } };
}
