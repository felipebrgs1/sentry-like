import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Onboarding (Fase 10): snippet de instalação/init do SDK por linguagem,
 * usado nos empty states. O DSN já vem montado (http://key@host/projId).
 */

const LANGS: Array<{ id: string; label: string }> = [
  { id: "js", label: "JS" },
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
  { id: "python", label: "Python" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
];

function snippet(lang: string, dsn: string): string {
  switch (lang) {
    case "react":
      return `# npm install --save @sentry/react
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "${dsn}",
  environment: "production",
  release: "web@1.0.0",
});`;
    case "vue":
      return `# npm install --save @sentry/vue
import * as Sentry from "@sentry/vue";

Sentry.init({
  app,
  dsn: "${dsn}",
  environment: "production",
});`;
    case "python":
      return `# pip install sentry-sdk
import sentry_sdk

sentry_sdk.init(
    dsn="${dsn}",
    environment="production",
    release="web@1.0.0",
)`;
    case "php":
      return `# composer require sentry/sentry
Sentry\\init([
  'dsn' => '${dsn}',
  'environment' => 'production',
]);`;
    case "ruby":
      return `# gem install sentry-ruby
Sentry.init do |config|
  config.dsn = '${dsn}'
  config.environment = 'production'
end`;
    default:
      return `# npm install --save @sentry/browser
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "${dsn}",
  environment: "production",
  release: "web@1.0.0",
});

// envie um evento de teste
Sentry.captureException(new Error("primeiro erro!"));`;
  }
}

export function SdkSnippet({ dsn }: { dsn: string }) {
  const [lang, setLang] = useState("js");
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(snippet(lang, dsn));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-3">
      <Tabs value={lang} onValueChange={(v) => setLang(v ?? "js")}>
        <TabsList>
          {LANGS.map((l) => (
            <TabsTrigger key={l.id} value={l.id}>
              {l.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="relative">
        <pre className="overflow-x-auto rounded border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground/85">
          {snippet(lang, dsn)}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="absolute top-2 right-2"
          title="copiar snippet"
        >
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
