import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { ContactDialog } from "@/components/contacts/contact-dialog";
import { ContactRowActions } from "@/components/contacts/contact-row-actions";
import { ImportContactsDialog } from "@/components/contacts/import-contacts-dialog";
import { WarehouseImportDialog } from "@/components/contacts/warehouse-import-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getWarehouseStats } from "@/lib/actions/warehouse";
import type { ContactStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Contacts" };

const PAGE_SIZE = 25;

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "REPLIED", label: "Replied" },
  { value: "UNSUBSCRIBED", label: "Unsubscribed" },
  { value: "DO_NOT_CONTACT", label: "Do not contact" },
];

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const status = typeof params.status === "string" ? params.status : "all";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const where = {
    ...(status !== "all" ? { status: status as ContactStatus } : {}),
    ...(query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" as const } },
            { firstName: { contains: query, mode: "insensitive" as const } },
            { lastName: { contains: query, mode: "insensitive" as const } },
            { company: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [contacts, total, warehouse] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.contact.count({ where }),
    getWarehouseStats(),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(next: number) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status !== "all") search.set("status", status);
    search.set("page", String(next));
    return `/contacts?${search.toString()}`;
  }

  function filterHref(value: string) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (value !== "all") search.set("status", value);
    return `/contacts?${search.toString()}`;
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Everyone in the database. Campaigns draw their audience from here."
      >
        <WarehouseImportDialog
          estimatedRows={warehouse.estimatedRows}
          imported={warehouse.imported}
        />
        <ImportContactsDialog />
        <ContactDialog />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search name, email, company…" />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              asChild
              size="sm"
              variant={status === filter.value ? "secondary" : "ghost"}
            >
              <Link href={filterHref(filter.value)}>{filter.label}</Link>
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground ml-auto text-sm tabular-nums">
          {total.toLocaleString()} contact{total === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {contacts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title={query || status !== "all" ? "No matching contacts" : "No contacts yet"}
                description={
                  query || status !== "all"
                    ? "Try a different search or filter."
                    : "Pull a batch out of the hl_contacts warehouse, import a CSV, or add contacts one at a time."
                }
              >
                <WarehouseImportDialog
                  estimatedRows={warehouse.estimatedRows}
                  imported={warehouse.imported}
                />
              </EmptyState>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <p className="font-medium">
                        {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
                      </p>
                      <p className="text-muted-foreground text-xs">{contact.email}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {contact.company ?? "—"}
                      {contact.jobTitle ? (
                        <p className="text-muted-foreground text-xs">{contact.jobTitle}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={contact.status} />
                    </TableCell>
                    <TableCell>
                      <ContactRowActions
                        contact={{
                          id: contact.id,
                          email: contact.email,
                          firstName: contact.firstName ?? "",
                          lastName: contact.lastName ?? "",
                          company: contact.company ?? "",
                          jobTitle: contact.jobTitle ?? "",
                          phone: contact.phone ?? "",
                          country: contact.country ?? "",
                          status: contact.status,
                          notes: contact.notes ?? "",
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Page {page} of {pageCount}
          </p>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link href={pageHref(Math.max(1, page - 1))}>Previous</Link>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={page >= pageCount}>
              <Link href={pageHref(Math.min(pageCount, page + 1))}>Next</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
