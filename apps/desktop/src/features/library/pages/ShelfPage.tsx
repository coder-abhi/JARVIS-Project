"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getBooks, updateBook, updateChapter, type Book, type BookStatus } from "@/lib/api";

type EditDraft = {
  title: string;
  author: string;
  category: string;
  status: BookStatus;
  purchasePrice: string;
};

const statusLabels: Record<BookStatus, string> = {
  yet_to_start: "Yet to start",
  reading: "Reading",
  read: "Read",
};

const statusClasses: Record<BookStatus, string> = {
  yet_to_start: "bg-amber-100 text-amber-800",
  reading: "bg-teal-100 text-teal-800",
  read: "bg-emerald-100 text-emerald-800",
};

export default function ShelfPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBooks()
      .then(setBooks)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  const totals = useMemo(
    () => ({
      books: books.length,
      pages: books.reduce((sum, book) => sum + book.total_pages, 0),
      spent: books.reduce((sum, book) => sum + (book.purchase_price ?? 0), 0),
      chapters: books.reduce((sum, book) => sum + book.chapters.length, 0),
      read: books.reduce((sum, book) => sum + book.pages_read, 0),
    }),
    [books],
  );

  async function patchBook(book: Book, changes: Partial<Book>) {
    const previous = books;
    setBooks((current) => current.map((item) => (item.id === book.id ? { ...item, ...changes } : item)));

    try {
      await updateBook(book.id, changes);
    } catch (err) {
      setBooks(previous);
      setError(err instanceof Error ? err.message : "Could not update book");
    }
  }

  function openEdit(book: Book) {
    setEditingBookId(book.id);
    setEditDrafts((current) => ({
      ...current,
      [book.id]: {
        title: book.title,
        author: book.author || "",
        category: book.category || "",
        status: book.status,
        purchasePrice: typeof book.purchase_price === "number" ? String(book.purchase_price) : "",
      },
    }));
  }

  async function saveEdit(book: Book) {
    const draft = editDrafts[book.id];
    if (!draft?.title.trim()) return;

    await patchBook(book, {
      title: draft.title.trim(),
      author: draft.author.trim() || null,
      category: draft.category.trim() || "Uncategorized",
      status: draft.status,
      purchase_price: draft.purchasePrice ? Number(draft.purchasePrice) : null,
    });
    setEditingBookId(null);
  }

  async function toggleChapter(bookId: string, chapterId: string, resonated: boolean) {
    const previous = books;
    setBooks((current) =>
      current.map((book) =>
        book.id === bookId
          ? {
              ...book,
              chapters: book.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, resonated } : chapter)),
            }
          : book,
      ),
    );

    try {
      await updateChapter(chapterId, resonated);
    } catch (err) {
      setBooks(previous);
      setError(err instanceof Error ? err.message : "Could not update chapter");
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f6f3] text-stone-950">
      <section className="border-b border-stone-200 bg-[linear-gradient(135deg,#fff8ed_0%,#effbf7_58%,#f7edf6_100%)]">
        <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-12">
          <Link href="/library" className="text-sm font-semibold text-teal-700 transition hover:text-teal-900">
            Back to Library
          </Link>
          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">Detailed shelf</p>
              <h1 className="mt-2 text-4xl font-semibold text-stone-950 md:text-5xl">All books</h1>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <ShelfMetric label="Books" value={totals.books.toString()} />
              <ShelfMetric label="Pages" value={totals.pages.toString()} />
              <ShelfMetric label="Spent" value={formatCurrency(totals.spent)} />
              <ShelfMetric label="Read" value={totals.read.toString()} />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-12">
        {error ? <p className="rounded-lg bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p> : null}
        {isLoading ? <p className="rounded-lg bg-white/80 p-6 text-sm text-stone-500">Loading shelf...</p> : null}

        {!isLoading ? (
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white/85 shadow-sm">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50/90 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Book</th>
                  <th className="px-4 py-3 font-semibold">Author</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Pages</th>
                  <th className="px-4 py-3 font-semibold">Chapters</th>
                  <th className="px-4 py-3 font-semibold">Resonated</th>
                  <th className="px-4 py-3 font-semibold">Bought</th>
                  <th className="px-4 py-3 font-semibold text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => {
                  const resonated = book.chapters.filter((chapter) => chapter.resonated).length;
                  const isExpanded = expandedBookId === book.id;
                  const isEditing = editingBookId === book.id;
                  const editDraft = editDrafts[book.id] ?? {
                    title: book.title,
                    author: book.author || "",
                    category: book.category || "",
                    status: book.status,
                    purchasePrice: typeof book.purchase_price === "number" ? String(book.purchase_price) : "",
                  };
                  return (
                    <Fragment key={book.id}>
                      <tr
                        key={book.id}
                        onClick={() => setExpandedBookId(isExpanded ? null : book.id)}
                        className="cursor-pointer border-t border-stone-100 transition hover:bg-stone-50/80"
                      >
                        <td className="px-4 py-4 font-semibold text-stone-950">{book.title}</td>
                        <td className="px-4 py-4 text-stone-600">{book.author || "Author unknown"}</td>
                        <td className="px-4 py-4 text-stone-600">{book.category || "Uncategorized"}</td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[book.status]}`}>
                            {statusLabels[book.status]}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-stone-600">{book.total_pages || "-"}</td>
                        <td className="px-4 py-4 text-stone-600">{book.chapters.length}</td>
                        <td className="px-4 py-4 text-stone-600">{resonated}</td>
                        <td className="px-4 py-4 text-stone-600">{book.purchase_date ? formatDate(book.purchase_date) : "-"}</td>
                        <td className="px-4 py-4 text-right font-semibold text-stone-700">
                          {typeof book.purchase_price === "number" ? formatCurrency(book.purchase_price) : "-"}
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr>
                          <td colSpan={9} className="border-t border-stone-100 bg-stone-50/60 px-4 py-5">
                            <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
                              <section className="rounded-lg border border-stone-200 bg-white p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Book details</p>
                                    <h2 className="mt-2 text-2xl font-semibold text-stone-950">{book.title}</h2>
                                    <p className="mt-2 text-sm text-stone-600">{book.author || "Author unknown"}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      isEditing ? setEditingBookId(null) : openEdit(book);
                                    }}
                                    className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50"
                                  >
                                    {isEditing ? "Cancel" : "Edit details"}
                                  </button>
                                </div>

                                {isEditing ? (
                                  <div className="mt-5 grid gap-3">
                                    <label className="text-sm font-semibold text-stone-700">
                                      Book name
                                      <input
                                        value={editDraft.title}
                                        onChange={(event) =>
                                          setEditDrafts((current) => ({
                                            ...current,
                                            [book.id]: { ...editDraft, title: event.target.value },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
                                      />
                                    </label>
                                    <label className="text-sm font-semibold text-stone-700">
                                      Category
                                      <input
                                        value={editDraft.category}
                                        onChange={(event) =>
                                          setEditDrafts((current) => ({
                                            ...current,
                                            [book.id]: { ...editDraft, category: event.target.value },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
                                      />
                                    </label>
                                    <label className="text-sm font-semibold text-stone-700">
                                      Author
                                      <input
                                        value={editDraft.author}
                                        onChange={(event) =>
                                          setEditDrafts((current) => ({
                                            ...current,
                                            [book.id]: { ...editDraft, author: event.target.value },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
                                      />
                                    </label>
                                    <label className="text-sm font-semibold text-stone-700">
                                      Status
                                      <select
                                        value={editDraft.status}
                                        onChange={(event) =>
                                          setEditDrafts((current) => ({
                                            ...current,
                                            [book.id]: { ...editDraft, status: event.target.value as BookStatus },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
                                      >
                                        {(Object.keys(statusLabels) as BookStatus[]).map((status) => (
                                          <option key={status} value={status}>
                                            {statusLabels[status]}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="text-sm font-semibold text-stone-700">
                                      Price
                                      <input
                                        inputMode="decimal"
                                        value={editDraft.purchasePrice}
                                        onChange={(event) =>
                                          setEditDrafts((current) => ({
                                            ...current,
                                            [book.id]: { ...editDraft, purchasePrice: event.target.value },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
                                      />
                                    </label>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        saveEdit(book);
                                      }}
                                      className="rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
                                    >
                                      Save details
                                    </button>
                                  </div>
                                ) : null}

                                <div className="mt-5 grid grid-cols-2 gap-3">
                                  <DetailMetric label="Pages read" value={book.pages_read.toString()} />
                                  <DetailMetric label="Remaining" value={book.pages_remaining.toString()} />
                                  <DetailMetric label="Total pages" value={(book.total_pages || 0).toString()} />
                                  <DetailMetric label="Chapters" value={book.chapters.length.toString()} />
                                  <DetailMetric label="Liked chapters" value={resonated.toString()} />
                                  <DetailMetric label="Price" value={typeof book.purchase_price === "number" ? formatCurrency(book.purchase_price) : "-"} />
                                </div>

                                <div className="mt-5">
                                  <p className="text-sm font-semibold text-stone-700">Rating</p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {Array.from({ length: 10 }, (_, index) => index + 1).map((rating) => (
                                      <button
                                        key={rating}
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          patchBook(book, { rating });
                                        }}
                                        className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold transition ${
                                          book.rating === rating ? "bg-stone-950 text-white" : "border border-stone-200 text-stone-600 hover:bg-stone-50"
                                        }`}
                                      >
                                        {rating}
                                      </button>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      patchBook(book, { rating: null });
                                    }}
                                    className="mt-3 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
                                  >
                                    Clear rating
                                  </button>
                                </div>
                              </section>

                              <section className="rounded-lg border border-stone-200 bg-white p-4">
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                  <div>
                                    <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Chapters</p>
                                    <h3 className="mt-1 text-xl font-semibold text-stone-950">Resonance list</h3>
                                  </div>
                                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[book.status]}`}>
                                    {statusLabels[book.status]}
                                  </span>
                                </div>

                                {book.chapters.length > 0 ? (
                                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                                    {book.chapters.map((chapter) => (
                                      <label key={chapter.id} className="flex items-start gap-3 rounded-md border border-stone-200 bg-stone-50/70 p-3">
                                        <input
                                          type="checkbox"
                                          checked={chapter.resonated}
                                          onChange={(event) => toggleChapter(book.id, chapter.id, event.target.checked)}
                                          className="mt-1 h-4 w-4 accent-teal-600"
                                        />
                                        <span>
                                          <span className="block text-sm font-semibold text-stone-950">
                                            {chapter.position}. {chapter.title}
                                          </span>
                                          <span className="mt-1 block text-xs text-stone-500">
                                            {chapter.resonated ? "Liked chapter" : "Mark as liked"}
                                          </span>
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-4 rounded-md bg-amber-50 p-4 text-sm text-amber-900">
                                    No chapters stored for this book yet.
                                  </p>
                                )}
                              </section>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            {books.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-base font-semibold text-stone-950">No books yet</p>
                <Link href="/library" className="mt-3 inline-block rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white">
                  Add Book
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ShelfMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/75 p-3 shadow-sm">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-50 p-3">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}
