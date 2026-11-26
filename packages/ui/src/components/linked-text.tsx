import { useCommentLinker } from "@parfocal/ui/lib/comment-links";

export function LinkedText({ text }: { text: string }) {
  const linker = useCommentLinker();
  if (linker === null) return <>{text}</>;
  return (
    <>
      {linker(text).map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <button
            key={`${index}-${part.text}`}
            type="button"
            data-slot="comment-link"
            onClick={(event) => {
              event.stopPropagation();
              part.reach();
            }}
            className="inline cursor-pointer border-0 bg-transparent p-0 font-mono font-semibold text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {part.text}
          </button>
        ),
      )}
    </>
  );
}
