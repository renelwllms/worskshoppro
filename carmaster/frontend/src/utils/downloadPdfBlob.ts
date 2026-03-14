export const downloadPdfBlob = (data: Blob | BlobPart, filename = 'invoice.pdf') => {
  const pdfBlob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
  if (pdfBlob.size === 0) return false;

  const blobUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return true;
};
