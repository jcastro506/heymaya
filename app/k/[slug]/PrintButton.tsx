"use client";

/** Some brand forms want a file: the browser's print dialog saves the kit as a PDF. */
export function PrintButton() {
  return (
    <button type="button" className="kit-print" onClick={() => window.print()}>
      Save as PDF
    </button>
  );
}
