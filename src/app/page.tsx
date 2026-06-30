import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EmbroideryStudio } from "@/components/embroidery-studio";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-md bg-foreground" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Embroidery Studio
              </h1>
              <p className="text-xs text-muted-foreground">
                画像から刺繍ミシン用データを生成・プレビュー
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">100% client-side</Badge>
            <Badge variant="outline">WASM</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <EmbroideryStudio />
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 text-xs text-muted-foreground">
          <span>© Embroidery Studio</span>
          <div className="flex items-center gap-3">
            <span>Next.js · Tailwind · shadcn/ui</span>
            <Separator orientation="vertical" className="h-3" />
            <span>OpenCV.js · potrace-wasm · pyodide</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
