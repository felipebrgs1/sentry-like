import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// base "/docs" para servir junto da API de produção (1 container);
// em dev o astro respeita o base path em http://localhost:4321/docs
const base = process.env.DOCS_BASE ?? "/docs";

export default defineConfig({
  site: "https://sentrylike.example",
  base,
  integrations: [
    starlight({
      title: "sentrylike docs",
      description:
        "Documentação do sentrylike — error tracking compatível com o protocolo do Sentry, rodando em uma VPS micro com Bun + SQLite.",
      favicon: "/favicon.svg",
      logo: {
        src: "./src/assets/sentrylike.svg",
        alt: "sentrylike",
      },
      customCss: ["./src/styles/custom.css"],
      components: {
        // mantém o header enxuto (sem link de edição em repo público)
        EditLink: "./src/components/EditLink.astro",
      },
      sidebar: [
        {
          label: "Introdução",
          items: [
            { label: "Sobre o projeto", slug: "intro" },
            { label: "Começar rápido", slug: "getting-started" },
            { label: "Roadmap", slug: "roadmap" },
          ],
        },
        {
          label: "Integração",
          items: [
            { label: "SDKs", slug: "sdk-setup" },
            { label: "Protocolo de ingestão", slug: "protocol" },
            { label: "Tunnel para browsers", slug: "tunnel" },
          ],
        },
        {
          label: "Funcionalidades",
          items: [
            { label: "Issues & grouping", slug: "issues" },
            { label: "Performance", slug: "performance" },
            { label: "Alertas", slug: "alerts" },
            { label: "Releases", slug: "releases" },
            { label: "Sourcemaps", slug: "sourcemaps" },
            { label: "Replays", slug: "replays" },
          ],
        },
        {
          label: "Referência",
          items: [
            { label: "Arquitetura", slug: "architecture" },
            { label: "API", slug: "api" },
            { label: "Deploy", slug: "deploy" },
          ],
        },
      ],
    }),
  ],
});
