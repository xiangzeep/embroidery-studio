"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, ImageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Props = {
  onImage: (src: string | null) => void;
};

const ACCEPTED = ["image/png", "image/jpeg", "image/svg+xml"];

export function ImageUploader({ onImage }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!ACCEPTED.includes(file.type)) {
        toast.error("PNG / JPEG / SVG のみ対応しています");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        onImage(typeof reader.result === "string" ? reader.result : null);
        setFileName(file.name);
      };
      reader.readAsDataURL(file);
    },
    [onImage],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1. 画像を読み込む</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          onClick={() => inputRef.current?.click()}
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-6 text-center transition-colors",
            isDragging
              ? "border-foreground bg-muted"
              : "border-muted-foreground/30 hover:bg-muted/50",
          ].join(" ")}
        >
          {fileName ? (
            <>
              <ImageIcon className="size-6 text-muted-foreground" />
              <div className="text-sm font-medium">{fileName}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setFileName(null);
                  onImage(null);
                }}
              >
                変更する
              </Button>
            </>
          ) : (
            <>
              <Upload className="size-6 text-muted-foreground" />
              <div className="text-sm">
                ドラッグ&ドロップ または クリックで選択
              </div>
              <div className="text-xs text-muted-foreground">
                PNG / JPEG / SVG
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
