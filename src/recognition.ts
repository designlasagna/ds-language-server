/** Find the innermost unclosed custom element before an offset. */
export function findParentCustomElement(text: string, offset: number): string | undefined {
  const before = text.slice(0, offset);
  const tagRegex = /<\/?([a-zA-Z][\w-]*)/g;
  const tags: { name: string; isClose: boolean }[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(before)) !== null) {
    const name = match[1];
    if (name?.includes('-')) {
      tags.push({ name, isClose: before[match.index + 1] === '/' });
    }
  }

  const closed: string[] = [];
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    if (!tag) continue;
    if (tag.isClose) closed.push(tag.name);
    else if (closed.at(-1) === tag.name) closed.pop();
    else return tag.name;
  }
  return undefined;
}
