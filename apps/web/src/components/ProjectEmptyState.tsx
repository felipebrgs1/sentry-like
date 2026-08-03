import { Rocket, ShieldCheck, Wrench } from "lucide-react";
import { SdkSnippet } from "./SdkSnippet";

/**
 * Empty state de integração (Fase 10): mostrado quando o projeto ainda não
 * recebeu eventos — guia de 3 passos + snippet do SDK por linguagem.
 */
export function ProjectEmptyState({ dsn }: { dsn: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="text-center">
        <Rocket className="mx-auto size-8 text-muted-foreground/60" />
        <h2 className="mt-2 text-lg font-semibold">Integre seu primeiro erro</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Este projeto ainda não recebeu eventos. Em três passos ele aparece no painel:
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <Wrench className="size-4 text-primary" />
          <p className="mt-1.5 text-sm font-medium">1. Instale o SDK</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use o SDK do Sentry da sua linguagem (lista ao lado).
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <ShieldCheck className="size-4 text-primary" />
          <p className="mt-1.5 text-sm font-medium">2. Configure o DSN</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Copie o snippet com o DSN deste projeto e rode o app.
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <Rocket className="size-4 text-primary" />
          <p className="mt-1.5 text-sm font-medium">3. Veja o erro aqui</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O primeiro evento cria a issue e dispara os alertas configurados.
          </p>
        </div>
      </div>

      <SdkSnippet dsn={dsn} />

      <p className="rounded-lg border bg-muted/30 p-3 text-center font-mono text-xs text-muted-foreground">
        Sem SDK? Teste com:{" "}
        <code className="text-foreground/80">bun scripts/send-test-event.ts "{dsn}"</code>
      </p>
    </div>
  );
}
