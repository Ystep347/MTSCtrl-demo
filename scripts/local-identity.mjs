// The standalone server has no trusted authentication edge. Incoming identity
// headers must be discarded; only explicit local preview can inject test data.
export function localRequestHeaders(incoming, editorPreview = false) {
  const headers = new Headers(incoming);
  for (const key of [...headers.keys()]) if (key.startsWith('oai-authenticated-')) headers.delete(key);
  if (editorPreview) {
    headers.set('oai-authenticated-user-id', 'preview-editor');
    headers.set('oai-authenticated-user-email', 'preview-editor@example.test');
    headers.set('oai-authenticated-user-full-name', encodeURIComponent('Редактор предпросмотра'));
    headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
  }
  return headers;
}
