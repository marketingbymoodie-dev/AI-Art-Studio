import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X } from "lucide-react";

async function uploadImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose a JPG, PNG, WebP, or GIF image.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Image must be under 8MB.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const res = await fetch("/api/uploads/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, name: file.name }),
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  if (!data.objectPath) throw new Error("Upload failed");
  return data.objectPath as string;
}

export function CreatorProfileImageField({
  label,
  hint,
  value,
  onChange,
  previewClassName,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  previewClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="flex items-start gap-3">
        {value ? (
          <img
            src={value}
            alt=""
            className={previewClassName || "h-16 w-16 rounded-md object-cover border"}
          />
        ) : (
          <div
            className={
              previewClassName ||
              "h-16 w-16 rounded-md border border-dashed bg-muted/40"
            }
          />
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setUploading(true);
              setError(null);
              try {
                onChange(await uploadImage(file));
              } catch (err: any) {
                setError(err?.message || "Upload failed");
              } finally {
                setUploading(false);
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-2 h-3.5 w-3.5" />
            )}
            {value ? "Replace" : "Upload"}
          </Button>
          {value ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={uploading}
              onClick={() => onChange("")}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
