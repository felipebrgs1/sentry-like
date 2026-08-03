import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesColumn, FolderKanban, Gauge, LayoutGrid, LogOut, Settings } from "lucide-react";
import type { ProjectWithStats, User } from "@sentrylike/shared";
import { api, logout } from "@/api";
import { SentrylikeLogo } from "./SentrylikeLogo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const navigate = useNavigate();
  const { location } = useRouterState();
  const pathname = location.pathname;

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectWithStats[]>("/v1/projects"),
    refetchInterval: 30_000,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User | null }>("/v1/auth/me"),
  });

  async function handleLogout() {
    await logout();
    navigate({ to: "/login" });
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
                <SentrylikeLogo size={18} />
              </div>
              <div className="leading-tight">
                <p className="font-semibold">sentrylike</p>
                <p className="text-xs text-muted-foreground">error tracking</p>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link to="/" />} isActive={pathname === "/"}>
                  <ChartNoAxesColumn />
                  <span>Visão geral</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link to="/projects" />}
                  isActive={pathname.startsWith("/projects") && pathname !== "/projects/"}
                >
                  <LayoutGrid />
                  <span>Projetos</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link to="/performance" />}
                  isActive={pathname.startsWith("/performance")}
                >
                  <Gauge />
                  <span>Performance</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projetos</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects?.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    render={<Link to="/projects/$projectId" params={{ projectId: String(p.id) }} />}
                    isActive={pathname.startsWith(`/projects/${p.id}`)}
                  >
                    <FolderKanban />
                    <span>{p.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {!projects?.length && (
                <SidebarMenuItem>
                  <span className="px-2 text-xs text-muted-foreground">sem projetos</span>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/settings" />}>
              <Settings />
              <span>{me?.user?.name ?? "Configurações"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout}>
              <LogOut />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
