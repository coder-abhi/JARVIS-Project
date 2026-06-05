"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import {
  addChapter,
  createBook,
  createReadingLog,
  deleteBookChapters,
  deleteChapter,
  getBooks,
  getLibraryRecommendations,
  getLibrarySummary,
  regenerateChapters,
  updateBook,
  updateChapter,
  type Book,
  type BookInput,
  type BookStatus,
  type LibrarySummary,
  type SuggestedBook,
} from "@/lib/api";
import { calculateRangeAverage } from "@/lib/chartAverage";
import "./LibraryPage.css";

type BookDraft = {
  title: string;
  author: string;
  category: string;
  totalPages: string;
  status: BookStatus;
  liked: boolean;
  purchaseDate: string;
  purchasePrice: string;
};

type ProgressDraft = {
  bookId: string;
  startPage: string;
  endPage: string;
  readDate: string;
};

type ReadingTrendMode = "regular" | "cumulative";
type ReadingTrendRange = 7 | 30 | 90 | 365;

type ReadingTrendPoint = {
  label: string;
  pages: number;
  shortLabel: string;
};

type ReadingTrend = {
  days: ReadingTrendRange;
  hasActivityBeforeRange: boolean;
  points: ReadingTrendPoint[];
  totalPages: number;
};

const emptyDraft: BookDraft = {
  title: "",
  author: "",
  category: "",
  totalPages: "",
  status: "yet_to_start",
  liked: false,
  purchaseDate: "",
  purchasePrice: "",
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

const categoryOptions = [
  "",
  "Software Development",
  "Technical",
  "Philosophy",
  "Psychology",
  "Productivity",
  "Biography",
  "Fiction",
  "General",
];

const readingTrendModeLabels: Record<ReadingTrendMode, string> = {
  regular: "Regular",
  cumulative: "Cumulative",
};

const readingTrendRangeLabels: Record<ReadingTrendRange, string> = {
  7: "Last 7 Days",
  30: "30 Days",
  90: "90 Days",
  365: "1 Year",
};

function getTodayDateValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function LibraryPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [draft, setDraft] = useState<BookDraft>(emptyDraft);
  const [progressDraft, setProgressDraft] = useState<ProgressDraft>({
    bookId: "",
    startPage: "",
    endPage: "",
    readDate: getTodayDateValue(),
  });
  const [chapterByBook, setChapterByBook] = useState<Record<string, string>>({});
  const [queuedBookIds, setQueuedBookIds] = useState<Record<string, boolean>>({});
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);
  const [readingTrendMode, setReadingTrendMode] = useState<ReadingTrendMode>("regular");
  const [readingTrendRange, setReadingTrendRange] = useState<ReadingTrendRange>(7);
  const [error, setError] = useState<string | null>(null);

  async function loadLocalLibraryData() {
    setError(null);
    const [nextBooks, nextSummary] = await Promise.all([
      getBooks(),
      getLibrarySummary(),
    ]);
    setBooks(nextBooks);
    setSummary(nextSummary);
    setProgressDraft((current) => {
      if (current.bookId && nextBooks.some((book) => book.id === current.bookId)) {
        return current;
      }

      const nextBook = nextBooks.find((book) => book.status === "reading") ?? nextBooks[0];
      return {
        ...current,
        bookId: nextBook?.id ?? "",
        startPage: nextBook ? String(getNextStartPage(nextBook)) : "",
      };
    });
  }

  async function loadSuggestionsInBackground() {
    setIsSuggestionsLoading(true);
    try {
      const nextSuggestions = await getLibraryRecommendations();
      setSuggestions(nextSuggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load AI book suggestions");
    } finally {
      setIsSuggestionsLoading(false);
    }
  }

  useEffect(() => {
    loadLocalLibraryData()
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        setIsLoading(false);
        void loadSuggestionsInBackground();
      });
  }, []);

  const readingBooks = useMemo(() => books.filter((book) => book.status === "reading"), [books]);
  const selectedProgressBook = useMemo(
    () => books.find((book) => book.id === progressDraft.bookId) ?? null,
    [books, progressDraft.bookId],
  );
  const recentPurchases = useMemo(
    () =>
      [...books]
        .filter((book) => book.purchase_date)
        .sort((a, b) => new Date(b.purchase_date ?? "").getTime() - new Date(a.purchase_date ?? "").getTime())
        .slice(0, 4),
    [books],
  );
  const readingTrend = useMemo(() => buildReadingTrend(summary, readingTrendRange), [summary, readingTrendRange]);

  useEffect(() => {
    if (!selectedProgressBook || progressDraft.startPage) return;

    setProgressDraft((current) =>
      current.bookId === selectedProgressBook.id && !current.startPage
        ? { ...current, startPage: String(getNextStartPage(selectedProgressBook)) }
        : current,
    );
  }, [selectedProgressBook, progressDraft.startPage]);

  async function handleCreateBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || isSaving) return;

    const payload: BookInput = {
      title: draft.title.trim(),
      author: draft.author.trim() || null,
      category: draft.category.trim(),
      total_pages: Number(draft.totalPages) || 0,
      status: draft.status,
      liked: draft.liked,
      purchase_date: draft.purchaseDate ? new Date(`${draft.purchaseDate}T00:00:00`).toISOString() : null,
      purchase_price: draft.purchasePrice ? Number(draft.purchasePrice) : null,
    };

    try {
      setIsSaving(true);
      setError(null);
      const created = await createBook(payload);
      await loadLocalLibraryData();
      setExpandedBookId(null);
      setQueuedBookIds((current) => ({ ...current, [created.id]: true }));
      window.setTimeout(() => {
        loadLocalLibraryData()
          .catch((err: Error) => setError(err.message))
          .finally(() => {
            setQueuedBookIds((current) => ({ ...current, [created.id]: false }));
            void loadSuggestionsInBackground();
          });
      }, 6000);
      setDraft(emptyDraft);
      setIsAddOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add book");
    } finally {
      setIsSaving(false);
    }
  }

  async function patchBook(book: Book, changes: Partial<BookInput>) {
    const previous = books;
    setBooks((current) => current.map((item) => (item.id === book.id ? { ...item, ...changes } : item)));
    try {
      await updateBook(book.id, changes);
      const nextSummary = await getLibrarySummary();
      setSummary(nextSummary);
    } catch (err) {
      setBooks(previous);
      setError(err instanceof Error ? err.message : "Could not update book");
    }
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

  function getNextStartPage(book: Book) {
    return Math.max(book.current_page || book.pages_read || 0, 0) + 1;
  }

  async function logProgress(event?: FormEvent<HTMLFormElement>, fallbackBook?: Book) {
    event?.preventDefault();
    const book = fallbackBook ?? selectedProgressBook;
    if (!book || isLogging) return;

    const startPage = Number(progressDraft.startPage);
    const endPage = Number(progressDraft.endPage);
    if (!startPage || !endPage || startPage < 1 || endPage < startPage) {
      setError("Choose a valid start and end page.");
      return;
    }

    try {
      setIsLogging(true);
      setError(null);
      await createReadingLog({
        book_id: book.id,
        start_page: startPage,
        end_page: endPage,
        read_at: new Date(`${progressDraft.readDate || getTodayDateValue()}T12:00:00`).toISOString(),
      });
      setProgressDraft((current) => ({ ...current, bookId: book.id, startPage: String(endPage + 1), endPage: "" }));
      await loadLocalLibraryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log reading");
    } finally {
      setIsLogging(false);
    }
  }

  async function handleAddChapter(book: Book) {
    const title = chapterByBook[book.id]?.trim();
    if (!title) return;

    try {
      await addChapter(book.id, title);
      setChapterByBook((current) => ({ ...current, [book.id]: "" }));
      await loadLocalLibraryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add chapter");
    }
  }

  async function handleRegenerateChapters(book: Book) {
    try {
      setQueuedBookIds((current) => ({ ...current, [book.id]: true }));
      await regenerateChapters(book.id);
      window.setTimeout(() => {
        loadLocalLibraryData()
          .catch((err: Error) => setError(err.message))
          .finally(() => setQueuedBookIds((current) => ({ ...current, [book.id]: false })));
      }, 7000);
    } catch (err) {
      setQueuedBookIds((current) => ({ ...current, [book.id]: false }));
      setError(err instanceof Error ? err.message : "Could not regenerate chapters");
    }
  }

  async function handleDeleteChapter(chapterId: string) {
    try {
      await deleteChapter(chapterId);
      await loadLocalLibraryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete chapter");
    }
  }

  async function handleDeleteAllChapters(book: Book) {
    try {
      await deleteBookChapters(book.id);
      await loadLocalLibraryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete chapters");
    }
  }

  return (
    <main className="ops-screen">
      <section className="ops-header">
        <div>
          <p className="ops-kicker">KNOWLEDGE COMMAND</p>
          <h1>Knowledge Command</h1>
          <p className="ops-subtitle">Reading operations, domain coverage, chapter signals, and knowledge feed.</p>
        </div>
        <div className="ops-header-actions">
          <button type="button" onClick={() => setIsAddOpen(true)} className="ops-button primary">
            Add Book
          </button>
          <a href="/library/shelf" className="ops-button">View Shelf</a>
        </div>
      </section>

      <section className="ops-grid">
        <div className="ops-panel span-4">
          <div className="ops-panel-head">
            <h2>Knowledge Health</h2>
            <span>books read / active / queued</span>
          </div>
          <div className="system-metrics">
            <HeroMetric label="Books Read" value={summary?.read_books ?? 0} />
            <HeroMetric label="Active Books" value={summary?.reading_books ?? 0} />
            <HeroMetric label="Queued Books" value={summary?.yet_to_start_books ?? 0} />
          </div>
        </div>

        <div className="ops-panel span-4">
          <div className="ops-panel-head">
            <h2>Reading Intelligence</h2>
            <span>pace and streak</span>
          </div>
          <div className="analysis-stack">
            <div><span>Pages This Week</span><strong>{summary?.pages_this_week ?? 0}</strong></div>
            <div><span>Pages This Month</span><strong>{getCurrentMonthPages(summary)}</strong></div>
            <div><span>Reading Streak</span><strong>{getReadingStreak(summary)} days</strong></div>
          </div>
        </div>

        <div className="ops-panel span-4">
          <div className="ops-panel-head">
            <h2>Knowledge Domains</h2>
            <span>AI / business / psychology / history / philosophy</span>
          </div>
          <div className="domain-grid">
            {["AI", "Business", "Psychology", "History", "Philosophy"].map((domain) => (
              <span key={domain} className={hasDomain(summary, domain) ? "ops-chip signal" : "ops-chip"}>{domain}</span>
            ))}
          </div>
        </div>

        <div className="ops-panel span-7">
          <div className="ops-panel-head">
            <h2>Current Operations</h2>
            <span>currently reading / progress / next chapter</span>
          </div>
          <div className="ops-table">
            <div className="ops-row ops-row-head library-row"><span>Book</span><span>Progress</span><span>Next Chapter</span></div>
            {readingBooks.length ? readingBooks.slice(0, 5).map((book) => (
              <div key={book.id} className="ops-row library-row">
                <span className="truncate">{book.title}</span>
                <span>{book.current_page || book.pages_read || 0}/{book.total_pages || "?"}</span>
                <span className="truncate">{book.chapters.find((chapter) => !chapter.resonated)?.title ?? "Review insights"}</span>
              </div>
            )) : <p className="ops-empty">No active reading operation.</p>}
          </div>
        </div>

        <div className="ops-panel span-5">
          <div className="ops-panel-head">
            <h2>Knowledge Feed</h2>
            <span>highlights / chapters / insights / quotes</span>
          </div>
          <div className="ops-feed">
            {buildKnowledgeFeed(books).map((item) => (
              <div key={item} className="feed-line"><span>INTEL</span><p>{item}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Reading rhythm</p>
              <h2 className="mt-2 text-3xl font-semibold text-stone-950">Reading Rhythm</h2>
            </div>
            <p className="text-sm text-stone-600">
              Current areas: {summary?.current_categories.length ? summary.current_categories.join(", ") : "No active category yet"}
            </p>
          </div>

          <ReadingTrendChart
            hasLoaded={!isLoading}
            mode={readingTrendMode}
            range={readingTrendRange}
            setMode={setReadingTrendMode}
            setRange={setReadingTrendRange}
            trend={readingTrend}
          />

          <section className="reading-log-panel mt-5">
            <div className="reading-log-head">
              <div>
                <p className="ops-kicker">Reading log</p>
                <h2>Log progress</h2>
              </div>
              {selectedProgressBook ? (
                <p className="reading-log-status">
                  <span>{selectedProgressBook.title}</span>
                  {" - "}
                  Page {selectedProgressBook.current_page || selectedProgressBook.pages_read || 0}
                  {selectedProgressBook.total_pages ? ` of ${selectedProgressBook.total_pages}` : ""} logged.
                </p>
              ) : null}
            </div>
            <form onSubmit={logProgress} className="reading-log-form">
              <Field label="Book name">
                <select
                  value={progressDraft.bookId}
                  onChange={(event) => {
                    const nextBook = books.find((book) => book.id === event.target.value);
                    setProgressDraft((current) => ({
                      ...current,
                      bookId: event.target.value,
                      startPage: nextBook ? String(getNextStartPage(nextBook)) : "",
                      endPage: "",
                    }));
                  }}
                  className="reading-log-input"
                  disabled={books.length === 0}
                >
                  {books.length === 0 ? <option value="">No books yet</option> : null}
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Date">
                <input
                  type="date"
                  value={progressDraft.readDate}
                  onChange={(event) => setProgressDraft((current) => ({ ...current, readDate: event.target.value }))}
                  className="reading-log-input"
                />
              </Field>

              <Field label="Start page">
                <input
                  inputMode="numeric"
                  value={progressDraft.startPage}
                  onChange={(event) => setProgressDraft((current) => ({ ...current, startPage: event.target.value }))}
                  className="reading-log-input"
                  disabled={!selectedProgressBook}
                />
              </Field>

              <Field label="End page">
                <input
                  inputMode="numeric"
                  value={progressDraft.endPage}
                  onChange={(event) => setProgressDraft((current) => ({ ...current, endPage: event.target.value }))}
                  className="reading-log-input"
                  disabled={!selectedProgressBook}
                />
              </Field>

              <button
                disabled={!selectedProgressBook || !progressDraft.endPage || isLogging}
                className="ops-button primary reading-log-button"
              >
                {isLogging ? "Logging..." : "Log Progress"}
              </button>
            </form>
          </section>

          {error ? <p className="mt-5 rounded-lg bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p> : null}
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div>
          <div id="reading-list" className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Ongoing books</p>
              <h2 className="mt-2 text-3xl font-semibold text-stone-950">Reading list</h2>
            </div>
          </div>

          {isLoading ? <p className="mt-8 rounded-lg bg-white/80 p-6 text-sm text-stone-500">Loading library...</p> : null}

          {!isLoading && books.length === 0 ? (
            <div className="mt-8 rounded-lg border border-dashed border-stone-300 bg-white/70 p-10 text-center">
              <h3 className="text-xl font-semibold text-stone-950">Your shelf is ready</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
                Add your first book. When OpenAI can identify it confidently, chapters will appear inside the row.
              </p>
              <button
                type="button"
                onClick={() => setIsAddOpen(true)}
                className="mt-6 rounded-full bg-stone-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Add Book
              </button>
            </div>
          ) : null}

          <div className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white/85 shadow-sm">
            {!isLoading && readingBooks.length > 0 ? (
              <div className="hidden grid-cols-[1fr_180px_140px_130px] gap-4 border-b border-stone-100 bg-stone-50/80 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid">
                <span>Book</span>
                <span>Author</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>
            ) : null}
            {!isLoading && books.length > 0 && readingBooks.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-base font-semibold text-stone-950">No books currently in progress</p>
                <p className="mt-2 text-sm text-stone-500">Mark a book as Reading to show it here.</p>
              </div>
            ) : null}
            {readingBooks.map((book) => {
              const isExpanded = expandedBookId === book.id;
              const resonantCount = book.chapters.filter((chapter) => chapter.resonated).length;
              return (
                <article key={book.id} className="border-b border-stone-100 last:border-0">
                  <button
                    type="button"
                    onClick={() => setExpandedBookId(isExpanded ? null : book.id)}
                    className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-stone-50/80 md:grid-cols-[1fr_180px_140px_130px] md:items-center md:gap-4"
                  >
                    <div>
                      <h3 className="text-base font-semibold text-stone-950">{book.title}</h3>
                      <p className="mt-1 text-xs text-stone-500 md:hidden">
                        {[book.author || "Author unknown", statusLabels[book.status]].join(" - ")}
                      </p>
                    </div>
                    <p className="hidden text-sm text-stone-600 md:block">{book.author || "Author unknown"}</p>
                    <div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[book.status]}`}>
                        {statusLabels[book.status]}
                      </span>
                    </div>
                    <div className="flex items-center justify-start gap-2 md:justify-end">
                      {book.liked ? <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">Liked</span> : null}
                      {queuedBookIds[book.id] ? <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-800">Updating</span> : null}
                      <span className="rounded-full border border-stone-200 px-3 py-1 text-xs font-semibold text-stone-600">
                        {isExpanded ? "Close" : "Open"}
                      </span>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-stone-100 bg-white px-5 pb-5 pt-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm text-stone-600">
                            {[book.category || "Uncategorized", book.total_pages ? `${book.total_pages} pages` : null].filter(Boolean).join(" - ")}
                          </p>
                          <p className="mt-2 text-sm text-stone-500">
                            Bought {book.purchase_date ? formatDate(book.purchase_date) : "date not logged"}
                            {typeof book.purchase_price === "number" ? ` for ${formatCurrency(book.purchase_price)}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                      {(Object.keys(statusLabels) as BookStatus[]).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => patchBook(book, { status })}
                          className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                            book.status === status ? "bg-stone-950 text-white" : "border border-stone-200 text-stone-600 hover:bg-stone-50"
                          }`}
                        >
                          {statusLabels[status]}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => patchBook(book, { liked: !book.liked })}
                        className="rounded-full border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
                      >
                        {book.liked ? "Unlike" : "Like"}
                      </button>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
                          <span className="rounded-md bg-stone-50 px-3 py-2 font-semibold text-stone-800">
                            Page {book.current_page || book.pages_read || 0}
                          </span>
                          <span>{book.pages_read} pages logged</span>
                          <span>{book.pages_remaining} remaining</span>
                          <button
                            type="button"
                            onClick={() =>
                              setProgressDraft((current) => ({
                                ...current,
                                bookId: book.id,
                                startPage: String(getNextStartPage(book)),
                                endPage: "",
                              }))
                            }
                            className="rounded-full border border-teal-200 px-4 py-2 text-xs font-semibold text-teal-700 transition hover:bg-teal-50"
                          >
                            Log progress
                          </button>
                        </div>
                        <p className="text-sm font-semibold text-stone-600">
                          Chapters {resonantCount}/{book.chapters.length}
                        </p>
                      </div>

                      <div className="mt-4 grid gap-3 rounded-md border border-stone-200 bg-stone-50/70 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                        <input
                          value={chapterByBook[book.id] ?? ""}
                          onChange={(event) => setChapterByBook((current) => ({ ...current, [book.id]: event.target.value }))}
                          placeholder="Add chapter manually"
                          className="w-full rounded-md border border-stone-300 px-4 py-2.5 text-sm outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddChapter(book)}
                          className="rounded-full bg-stone-950 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-stone-800"
                        >
                          Add Chapter
                        </button>
                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <button
                            type="button"
                            onClick={() => handleRegenerateChapters(book)}
                            className="rounded-full border border-stone-300 px-4 py-2.5 text-xs font-semibold text-stone-700 transition hover:bg-white"
                          >
                            {queuedBookIds[book.id] ? "Queued" : "Regenerate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAllChapters(book)}
                            className="rounded-full border border-red-200 px-4 py-2.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Delete Chapters
                          </button>
                        </div>
                      </div>

                      {book.chapters.length > 0 ? (
                        <div className="mt-5 grid gap-2 border-t border-stone-100 pt-5 md:grid-cols-2">
                          {book.chapters.map((chapter) => (
                            <div key={chapter.id} className="flex items-start gap-3 rounded-md border border-stone-200 bg-stone-50/70 p-3">
                              <label className="flex flex-1 items-start gap-3">
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
                                  <span className="mt-1 block text-xs text-stone-500">Mark this if the chapter resonated.</span>
                                </span>
                              </label>
                              <button
                                type="button"
                                onClick={() => handleDeleteChapter(chapter.id)}
                                className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-5 rounded-md bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                          No confident chapter list is stored for this book yet.
                        </p>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-stone-200 bg-white/80 p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">AI next buys</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">Suggested books</h2>
            <div className="mt-4 space-y-4">
              {isSuggestionsLoading && suggestions.length === 0 ? <p className="text-sm text-stone-500">Loading suggestions in the background...</p> : null}
              {suggestions.map((book) => (
                <div key={`${book.title}-${book.author}`} className="rounded-md bg-stone-50 p-4">
                  <p className="text-sm font-semibold text-stone-950">{book.title}</p>
                  <p className="mt-1 text-xs text-stone-500">{[book.author, book.category].filter(Boolean).join(" - ")}</p>
                  <p className="mt-3 text-sm leading-6 text-stone-600">{book.reason}</p>
                </div>
              ))}
              {!isSuggestionsLoading && suggestions.length === 0 ? <p className="text-sm text-stone-500">Suggestions will appear here after your shelf loads.</p> : null}
            </div>
          </section>

          <section className="rounded-lg border border-stone-200 bg-white/80 p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Recent purchases</p>
            <div className="mt-4 space-y-3">
              {recentPurchases.map((book) => (
                <div key={book.id} className="flex items-center justify-between gap-4 border-b border-stone-100 pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold text-stone-950">{book.title}</p>
                    <p className="mt-1 text-xs text-stone-500">{formatDate(book.purchase_date ?? "")}</p>
                  </div>
                  <p className="text-sm font-semibold text-stone-700">
                    {typeof book.purchase_price === "number" ? formatCurrency(book.purchase_price) : "-"}
                  </p>
                </div>
              ))}
              {recentPurchases.length === 0 ? <p className="text-sm text-stone-500">Purchase history will appear here.</p> : null}
            </div>
          </section>
        </aside>
        </div>
      </section>

      {isAddOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-stone-950/45 px-5 py-8 backdrop-blur-sm">
          <form onSubmit={handleCreateBook} className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl shadow-stone-950/30">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">New book</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-950">Add Book</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 text-xl leading-none text-stone-500 transition hover:bg-stone-50 hover:text-stone-950"
                aria-label="Close"
              >
                x
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="Title">
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  autoFocus
                  className="field-input"
                  required
                />
              </Field>
              <Field label="Author">
                <input
                  value={draft.author}
                  onChange={(event) => setDraft((current) => ({ ...current, author: event.target.value }))}
                  className="field-input"
                />
              </Field>
              <Field label="Category">
                <select
                  value={draft.category}
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                  className="field-input"
                >
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category || "Let OpenAI identify"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Total pages">
                <input
                  inputMode="numeric"
                  value={draft.totalPages}
                  onChange={(event) => setDraft((current) => ({ ...current, totalPages: event.target.value }))}
                  className="field-input"
                />
              </Field>
              <Field label="Bought on">
                <input
                  type="date"
                  value={draft.purchaseDate}
                  onChange={(event) => setDraft((current) => ({ ...current, purchaseDate: event.target.value }))}
                  className="field-input"
                />
              </Field>
              <Field label="Purchase price">
                <input
                  inputMode="decimal"
                  value={draft.purchasePrice}
                  onChange={(event) => setDraft((current) => ({ ...current, purchasePrice: event.target.value }))}
                  className="field-input"
                  placeholder="0.00"
                />
              </Field>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {(Object.keys(statusLabels) as BookStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, status }))}
                  className={`rounded-md border p-4 text-left transition ${
                    draft.status === status ? "border-teal-600 bg-teal-50" : "border-stone-200 bg-white hover:bg-stone-50"
                  }`}
                >
                  <span className="font-semibold text-stone-950">{statusLabels[status]}</span>
                </button>
              ))}
            </div>

            <label className="mt-5 flex items-center gap-3 text-sm font-semibold text-stone-700">
              <input
                type="checkbox"
                checked={draft.liked}
                onChange={(event) => setDraft((current) => ({ ...current, liked: event.target.checked }))}
                className="h-4 w-4 accent-teal-600"
              />
              I already know I like this book
            </label>

            <div className="mt-6 rounded-md bg-teal-50 p-4 text-sm leading-6 text-teal-900">
              Saving asks OpenAI only for missing metadata and exact chapters. If confidence is low, the book is saved without invented details.
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                disabled={isSaving || !draft.title.trim()}
                className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {isSaving ? "Checking book..." : "Add Book"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="system-metric">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function getCurrentMonthPages(summary: LibrarySummary | null) {
  const currentMonth = new Date();
  const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`;
  return summary?.monthly_pages.find((month) => month.month === key)?.pages ?? 0;
}

function getReadingStreak(summary: LibrarySummary | null) {
  const pagesByDate = (summary?.daily_pages ?? summary?.daywise_pages ?? []).reduce<Record<string, number>>((acc, day) => {
    acc[day.date] = day.pages;
    return acc;
  }, {});
  let streak = 0;
  let cursor = startOfDay(new Date());
  while ((pagesByDate[dateKey(cursor)] ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function hasDomain(summary: LibrarySummary | null, domain: string) {
  const normalized = domain.toLowerCase();
  return (
    summary?.categories.some((item) => item.category.toLowerCase().includes(normalized)) ||
    summary?.current_categories.some((item) => item.toLowerCase().includes(normalized)) ||
    false
  );
}

function buildKnowledgeFeed(books: Book[]) {
  const chapterSignals = books.flatMap((book) =>
    book.chapters.filter((chapter) => chapter.resonated).map((chapter) => `${book.title}: ${chapter.title}`),
  );
  const activeBooks = books.filter((book) => book.status === "reading").map((book) => `Currently reading ${book.title}`);
  const likedBooks = books.filter((book) => book.liked).map((book) => `Favorite signal logged for ${book.title}`);
  const feed = [...chapterSignals, ...activeBooks, ...likedBooks].slice(0, 6);
  return feed.length ? feed : ["Awaiting highlights, favorite chapters, insights, and quotes."];
}

function ReadingTrendChart({
  hasLoaded,
  mode,
  range,
  setMode,
  setRange,
  trend,
}: {
  hasLoaded: boolean;
  mode: ReadingTrendMode;
  range: ReadingTrendRange;
  setMode: (mode: ReadingTrendMode) => void;
  setRange: (range: ReadingTrendRange) => void;
  trend: ReadingTrend;
}) {
  let runningTotal = 0;
  const chartPoints = trend.points.map((point) => {
    runningTotal += point.pages;
    return {
      ...point,
      value: mode === "cumulative" ? runningTotal : point.pages,
    };
  });
  const averageValue = calculateRangeAverage(
    chartPoints.map((point) => point.value),
    trend.hasActivityBeforeRange,
  );
  const maxValue = Math.max(...chartPoints.map((point) => point.value), averageValue);
  const maxY = Math.max(10, Math.ceil(maxValue / 25) * 25);
  const xForIndex = (index: number) => (index / Math.max(1, chartPoints.length - 1)) * 100;
  const yForValue = (value: number) => 92 - (value / maxY) * 84;
  const linePoints = chartPoints.map((point, index) => `${xForIndex(index)},${yForValue(point.value)}`).join(" ");
  const averageY = yForValue(averageValue);
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => Math.round(maxY * ratio));
  const labelIndexes = getReadingTrendLabelIndexes(trend);
  const visibleChartPoints = chartPoints.filter((_, index) => labelIndexes.includes(index));
  const hasLoggedPages = trend.totalPages > 0;

  return (
    <div className="mt-6 rounded-lg border border-stone-200 bg-white/80 p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm font-semibold text-stone-700">Pages logged</p>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <div className="flex rounded-full border border-stone-200 bg-stone-100 p-1">
            {(["regular", "cumulative"] as ReadingTrendMode[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`inline-flex h-7 min-w-[5.25rem] items-center justify-center rounded-full px-3 text-xs font-semibold transition ${
                  mode === option ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white hover:text-stone-950"
                }`}
              >
                {readingTrendModeLabels[option]}
              </button>
            ))}
          </div>
          <label className="relative">
            <span className="sr-only">Reading rhythm range</span>
            <select
              value={range}
              onChange={(event) => setRange(Number(event.target.value) as ReadingTrendRange)}
              className="h-9 rounded-full border border-stone-200 bg-white pl-4 pr-9 text-xs font-semibold text-stone-700 outline-none transition hover:border-stone-300 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/15"
            >
              {([7, 30, 90, 365] as ReadingTrendRange[]).map((option) => (
                <option key={option} value={option}>
                  {readingTrendRangeLabels[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {hasLoaded ? (
        <div className="mt-4">
          <div className="grid grid-cols-[3rem_1fr] gap-3">
            <div className="relative h-64">
              {yTicks.map((pages, index) =>
                pages === averageValue ? null : (
                  <span
                    key={`${pages}-${index}`}
                    className="absolute right-0 -translate-y-1/2 text-xs font-medium text-stone-500"
                    style={{ top: `${yForValue(pages)}%` }}
                  >
                    {pages}
                  </span>
                ),
              )}
              <span
                className="absolute right-0 -translate-y-1/2 text-xs font-semibold leading-tight text-orange-500"
                style={{ top: `${averageY}%` }}
              >
                {averageValue}
              </span>
            </div>
            <div>
              <div className="relative h-64">
                <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${readingTrendModeLabels[mode]} Pages Read ${readingTrendRangeLabels[range]}`}>
                  {yTicks.map((pages, index) => {
                    const y = yForValue(pages);
                    return <polyline key={`${pages}-${index}`} points={`0,${y} 100,${y}`} fill="none" stroke="#e7e5e4" strokeWidth="0.45" vectorEffect="non-scaling-stroke" />;
                  })}
                  <polyline
                    points={`0,${averageY} 100,${averageY}`}
                    fill="none"
                    stroke="#f97316"
                    strokeDasharray="5 5"
                    strokeWidth="1.2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline points={linePoints} fill="none" stroke="#0d9488" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                {visibleChartPoints.map((point, pointIndex) => {
                  const sourceIndex = labelIndexes[pointIndex];
                  const x = xForIndex(sourceIndex);
                  const y = yForValue(point.value);

                  return (
                    <Fragment key={`${point.label}-point`}>
                      <span
                        className="pointer-events-none absolute h-2 w-2 rounded-full border-2 border-teal-700 bg-white shadow-sm"
                        style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                      />
                      <span
                        className={`pointer-events-none absolute -translate-y-[calc(100%+0.45rem)] rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 shadow-sm ring-1 ring-teal-100 ${
                          sourceIndex === 0 ? "translate-x-0" : sourceIndex === chartPoints.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
                        }`}
                        style={{ left: `${x}%`, top: `${y}%` }}
                      >
                        {point.value}
                      </span>
                    </Fragment>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${labelIndexes.length || 1}, minmax(0, 1fr))` }}>
                {visibleChartPoints.map((point) => (
                  <p key={`${point.label}-label`} className="text-center text-[10px] font-medium text-stone-500">
                    {point.shortLabel}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {!hasLoggedPages ? (
            <p className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm font-medium text-stone-600">
              No pages logged in this range yet.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-[3rem_1fr] gap-3">
          <div className="h-64" />
          <div className="h-64 rounded-lg border border-dashed border-stone-300 bg-stone-50" />
        </div>
      )}
    </div>
  );
}

function buildReadingTrend(summary: LibrarySummary | null, range: ReadingTrendRange): ReadingTrend {
  if (range === 365) {
    const monthlyPages = summary?.monthly_pages.length ? summary.monthly_pages : buildEmptyMonthlyPages();
    const rangeStart = `${monthlyPages[0].month}-01`;
    const firstReadingDate = getFirstReadingDate(summary);
    const points = monthlyPages.map((month) => ({
      label: new Date(`${month.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      pages: month.pages,
      shortLabel: formatMonth(month.month),
    }));

    return {
      days: range,
      hasActivityBeforeRange: Boolean(firstReadingDate && firstReadingDate < rangeStart),
      points,
      totalPages: points.reduce((sum, point) => sum + point.pages, 0),
    };
  }

  const sourcePages = summary?.daily_pages ?? summary?.daywise_pages ?? [];
  const pagesByDate = sourcePages.reduce<Record<string, number>>((acc, day) => {
    acc[day.date] = day.pages;
    return acc;
  }, {});
  const today = startOfDay(new Date());
  const start = addDays(today, -(range - 1));
  const firstReadingDate = getFirstReadingDate(summary);
  const points = Array.from({ length: range }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);

    return {
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      pages: pagesByDate[key] ?? 0,
      shortLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    };
  });

  return {
    days: range,
    hasActivityBeforeRange: Boolean(firstReadingDate && firstReadingDate < dateKey(start)),
    points,
    totalPages: points.reduce((sum, point) => sum + point.pages, 0),
  };
}

function getFirstReadingDate(summary: LibrarySummary | null) {
  if (summary?.first_reading_date) return summary.first_reading_date;

  return (summary?.daily_pages ?? summary?.daywise_pages ?? []).find((day) => day.pages > 0)?.date ?? null;
}

function getReadingTrendLabelIndexes(trend: ReadingTrend) {
  if (trend.days === 365) {
    return trend.points.map((_, index) => index);
  }

  const count = trend.days === 7 ? 7 : 10;
  const lastIndex = trend.points.length - 1;
  const indexes = Array.from({ length: count }, (_, index) => Math.round((index / Math.max(1, count - 1)) * lastIndex));
  return Array.from(new Set(indexes));
}

function buildEmptyMonthlyPages() {
  const months = [];
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  for (let index = 11; index >= 0; index -= 1) {
    const month = new Date(cursor);
    month.setMonth(cursor.getMonth() - index);
    months.push({
      month: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
      pages: 0,
    });
  }

  return months;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-stone-700">
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function dateKey(date: Date) {
  const day = startOfDay(date);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function formatMonth(value: string) {
  return new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: "short" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}
