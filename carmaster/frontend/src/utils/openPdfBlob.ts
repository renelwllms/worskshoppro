type OpenPdfOptions = {
  printDelayMs?: number;
};

export const openPdfBlob = (data: Blob | BlobPart, options: OpenPdfOptions = {}) => {
  const pdfBlob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
  if (pdfBlob.size === 0) {
    return false;
  }

  const blobUrl = URL.createObjectURL(pdfBlob);
  const win = window.open(blobUrl, '_blank');
  if (!win) {
    window.location.href = blobUrl;
    return true;
  }

  win.focus();
  const delay = Number.isFinite(options.printDelayMs) ? (options.printDelayMs as number) : 800;
  setTimeout(() => {
    try {
      win.print();
    } catch {
      // Ignore print errors for PDF viewers.
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }, delay);
  return true;
};
