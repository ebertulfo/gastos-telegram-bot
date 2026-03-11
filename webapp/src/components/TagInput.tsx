import { useState, useRef, useEffect } from "react";

type TagInputProps = {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
};

const TAG_REGEX = /^[a-zA-Z0-9\- ]+$/;
const MAX_TAG_LENGTH = 30;

export function TagInput({ tags, allTags, onChange }: TagInputProps) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const suggestions = input.trim()
    ? allTags
        .filter((t) => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t))
        .slice(0, 5)
    : [];

  const addTag = (tag: string) => {
    const cleaned = tag.toLowerCase().trim();
    if (!cleaned || cleaned.length > MAX_TAG_LENGTH || !TAG_REGEX.test(cleaned)) return;
    if (tags.includes(cleaned)) return;
    onChange([...tags, cleaned]);
    setInput("");
    setFocusedIdx(-1);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIdx >= 0 && focusedIdx < suggestions.length) {
        addTag(suggestions[focusedIdx]);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setAdding(false);
      setInput("");
      setFocusedIdx(-1);
    }
  };

  const handleBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => {
      if (!input.trim()) {
        setAdding(false);
        setFocusedIdx(-1);
      }
    }, 150);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
            style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
          >
            #{tag}
            <button
              onClick={() => removeTag(tag)}
              className="ml-0.5 text-[10px] opacity-60 hover:opacity-100"
              style={{ color: "var(--text-secondary)" }}
            >
              ✕
            </button>
          </span>
        ))}
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--text-secondary)", color: "var(--text-secondary)" }}
          >
            + Add
          </button>
        )}
      </div>

      {adding && (
        <div className="relative mt-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFocusedIdx(-1);
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Type a tag..."
            maxLength={MAX_TAG_LENGTH}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{
              background: "var(--surface-hover)",
              borderColor: "var(--border)",
              color: "var(--foreground)",
            }}
          />
          {suggestions.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border shadow-lg"
              style={{ background: "var(--background)", borderColor: "var(--border)" }}
            >
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(s);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm"
                  style={{
                    color: "var(--foreground)",
                    background: i === focusedIdx ? "var(--surface)" : "transparent",
                  }}
                >
                  #{s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
