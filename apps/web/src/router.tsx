import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { getToken } from "./api";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { ProjectsPage } from "./pages/Projects";
import { ProjectIssuesPage } from "./pages/ProjectIssues";
import { PerformancePage } from "./pages/Performance";
import { PerformanceGlobalPage } from "./pages/PerformanceGlobal";
import { IssueDetailPage } from "./pages/IssueDetail";

function requireAuth() {
  if (!getToken()) throw redirect({ to: "/login" });
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: () => {
    if (getToken()) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app", // pathless layout — o id precisa começar com _ nesta versão do router
  beforeLoad: requireAuth,
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: OverviewPage,
});

const projectsIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects",
  component: ProjectsPage,
});

const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId",
  component: ProjectIssuesPage,
});

const projectPerformanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId/performance",
  component: PerformancePage,
});

const performanceGlobalRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/performance",
  component: PerformanceGlobalPage,
});

const issueRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/issues/$issueId",
  component: IssueDetailPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    projectsIndexRoute,
    performanceGlobalRoute,
    projectRoute,
    projectPerformanceRoute,
    issueRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
