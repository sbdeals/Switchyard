import { filterImageTags, parseImageRef, type ImageTag } from "./image-ref";

/** Include the saved tag even when it has fallen outside the recent page. */
export function imageTagOptions(image: string, currentImage: string, tags: ImageTag[], search: boolean) {
  const ref = parseImageRef(image);
  const current = parseImageRef(currentImage);
  const sameRepository = ref && current && ref.registry === current.registry &&
    ref.namespace === current.namespace && ref.repository === current.repository;
  const currentTag = sameRepository ? current.tag ?? (current.digest ? null : "latest") : null;
  const options = currentTag && !tags.some((tag) => tag.name === currentTag)
    ? [...tags, { name: currentTag, lastPushed: null }]
    : tags;
  return filterImageTags(options, search ? ref?.tag ?? "" : "").map((tag) => ({
    ...tag,
    current: tag.name === currentTag,
  }));
}

/** Arrow keys stay within the rendered options; typing never selects a tag. */
export function nextTagIndex(key: string, active: number, count: number): number {
  if (!count) return -1;
  if (key === "ArrowDown") return Math.min(active + 1, count - 1);
  if (key === "ArrowUp") return active < 0 ? count - 1 : Math.max(active - 1, 0);
  return active;
}
