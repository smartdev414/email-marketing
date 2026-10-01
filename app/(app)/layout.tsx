import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <SidebarProvider>
      <AppSidebar>
        <UserMenu
          name={session.user.name}
          email={session.user.email}
          image={session.user.image}
          role={session.user.role}
        />
      </AppSidebar>
      <SidebarInset>
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
