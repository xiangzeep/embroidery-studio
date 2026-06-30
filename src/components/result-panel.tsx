"use client";

import { Download, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { EmbroideryFormat } from "@/lib/pipeline/config";

type Result = {
  stitchCount: number;
  colorCount: number;
  fileBlob: Blob;
};

type Props = {
  result: Result | null;
  format: EmbroideryFormat;
};

export function ResultPanel({ result, format }: Props) {
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.fileBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `embroidery.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">3. 結果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result ? (
          <>
            <Stat label="総ステッチ数" value={result.stitchCount.toLocaleString()} />
            <Stat label="色数" value={`${result.colorCount} 色`} />
            <Stat label="形式" value={format.toUpperCase()} />
            <Separator />
            <Button className="w-full" onClick={download}>
              <Download className="size-4" />
              ファイルをダウンロード
            </Button>
          </>
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>
                左のパネルで画像とパラメータを設定し、「刺繍データを生成」を押すと
                ここに結果が表示されます。
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">サーバ送信なし</Badge>
              <Badge variant="outline">完全ローカル</Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
