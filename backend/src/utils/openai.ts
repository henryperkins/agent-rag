export function extractOutputText(response: any): string {
  if (response?.output_text) {
    return response.output_text;
  }

  if (Array.isArray(response?.output)) {
    let text = '';
    for (const item of response.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (
            (part?.type === 'output_text' || part?.type === 'text') &&
            typeof part.text === 'string'
          ) {
            text += part.text;
          }
        }
      }
    }
    return text;
  }

  return '';
}
