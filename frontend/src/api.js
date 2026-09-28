/**
 * SSE-over-POST doesn't work with EventSource (browser limitation - it's
 * GET-only), so this reads the stream manually and calls onEvent for each
 * parsed step as it arrives.
 */
export async function analyzeStream({ file, documentText, question }, onEvent) {
  const formData = new FormData()
  formData.append('question', question)
  if (file) {
    formData.append('file', file)
  } else {
    formData.append('document_text', documentText)
  }

  const response = await fetch('/api/analyze-stream', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n\n')
    buffer = lines.pop() // keep the last, possibly-incomplete chunk

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const event = JSON.parse(line.slice('data: '.length))
      onEvent(event)
    }
  }
}
