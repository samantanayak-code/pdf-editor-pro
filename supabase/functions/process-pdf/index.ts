import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { PDFDocument, rgb, StandardFonts, degrees } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ProcessPDFRequest {
  operation: 'merge' | 'split' | 'rotate' | 'paginate' | 'header_footer' | 'extract' | 'delete' | 'reorder';
  files?: string[];
  filePaths?: string[];
  options?: any;
}

interface HeaderFooterOptions {
  headerText?: string;
  footerText?: string;
  position?: string;
  fontSize?: number;
  color?: { r: number; g: number; b: number };
  excludePages?: number[];
  marginX?: number;
  marginY?: number;
  fileName?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    const tier = profile?.subscription_tier || "free";

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: usageLogs } = await supabaseClient
      .from("usage_logs")
      .select("id")
      .eq("user_id", user.id)
      .gte("created_at", thirtyDaysAgo.toISOString());

    const { data: plan } = await supabaseClient
      .from("subscription_plans")
      .select("max_operations_per_month")
      .eq("name", tier)
      .single();

    const limit = plan?.max_operations_per_month || 10;
    const currentUsage = usageLogs?.length || 0;

    if (limit !== -1 && currentUsage >= limit) {
      return new Response(
        JSON.stringify({
          error: "Monthly limit reached. Upgrade to Pro for unlimited operations.",
          currentUsage,
          limit,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const requestBody: ProcessPDFRequest = await req.json();
    const { operation, files, filePaths, options } = requestBody;

    let resultPDF: Uint8Array;
    let pageCount = 0;

    switch (operation) {
      case 'merge': {
        const pdfDoc = await PDFDocument.create();
        const pathsToUse = filePaths || files || [];

        if (pathsToUse.length === 0) {
          throw new Error('No files provided for merge');
        }

        console.log(`Starting merge of ${pathsToUse.length} files`);
        const mergeStartTime = Date.now();

        for (let i = 0; i < pathsToUse.length; i++) {
          try {
            const filePath = pathsToUse[i];
            console.log(`Processing file ${i + 1}/${pathsToUse.length}: ${filePath}`);

            let arrayBuffer: ArrayBuffer;

            if (filePath.startsWith('http')) {
              const response = await fetch(filePath);
              if (!response.ok) {
                throw new Error(`Failed to fetch file ${i + 1}: ${response.statusText}`);
              }
              arrayBuffer = await response.arrayBuffer();
            } else {
              const { data, error } = await supabaseClient.storage
                .from('processed-pdfs')
                .download(filePath);

              if (error || !data) {
                throw new Error(`Failed to download file ${i + 1}: ${error?.message || 'Unknown error'}`);
              }

              arrayBuffer = await data.arrayBuffer();
            }

            console.log(`File ${i + 1} size: ${arrayBuffer.byteLength} bytes`);

            if (arrayBuffer.byteLength === 0) {
              throw new Error(`File ${i + 1} is empty`);
            }

            const sourcePdf = await PDFDocument.load(arrayBuffer, {
              ignoreEncryption: true,
              updateMetadata: false
            });

            const sourcePageCount = sourcePdf.getPageCount();
            console.log(`File ${i + 1} has ${sourcePageCount} pages`);

            if (sourcePageCount === 0) {
              throw new Error(`File ${i + 1} has no pages`);
            }

            const copiedPages = await pdfDoc.copyPages(sourcePdf, sourcePdf.getPageIndices());
            copiedPages.forEach((page) => pdfDoc.addPage(page));

            console.log(`Successfully merged file ${i + 1} in ${Date.now() - mergeStartTime}ms`);
          } catch (fileError) {
            console.error(`Error processing file ${i + 1}:`, fileError);
            throw new Error(`Failed to process file ${i + 1}: ${fileError.message}`);
          }
        }

        resultPDF = await pdfDoc.save();
        pageCount = pdfDoc.getPageCount();
        console.log(`Merge complete: ${pageCount} total pages in ${Date.now() - mergeStartTime}ms`);
        break;
      }

      case 'rotate': {
        const pathToUse = (filePaths && filePaths[0]) || (files && files[0]);
        if (!pathToUse) throw new Error('No file provided for rotation');

        let arrayBuffer: ArrayBuffer;

        if (pathToUse.startsWith('http')) {
          const response = await fetch(pathToUse);
          arrayBuffer = await response.arrayBuffer();
        } else {
          const { data, error } = await supabaseClient.storage
            .from('processed-pdfs')
            .download(pathToUse);
          if (error || !data) throw error;
          arrayBuffer = await data.arrayBuffer();
        }

        const pdfDoc = await PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();

        const { pages: pageNumbers, angle } = options;

        for (const pageNum of pageNumbers) {
          const pageIndex = pageNum - 1;
          if (pageIndex >= 0 && pageIndex < pages.length) {
            const page = pages[pageIndex];
            const currentRotation = page.getRotation().angle;
            page.setRotation(degrees(currentRotation + angle));
          }
        }

        resultPDF = await pdfDoc.save();
        pageCount = pages.length;
        break;
      }

      case 'paginate': {
        const pathToUse = (filePaths && filePaths[0]) || (files && files[0]);
        if (!pathToUse) throw new Error('No file provided for pagination');

        let arrayBuffer: ArrayBuffer;

        if (pathToUse.startsWith('http')) {
          const response = await fetch(pathToUse);
          arrayBuffer = await response.arrayBuffer();
        } else {
          const { data, error } = await supabaseClient.storage
            .from('processed-pdfs')
            .download(pathToUse);
          if (error || !data) throw error;
          arrayBuffer = await data.arrayBuffer();
        }

        const pdfDoc = await PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const {
          format,
          startNumber = 1,
          position,
          fontSize = 10,
          color = { r: 0, g: 0, b: 0 },
          excludePages = [],
          marginX = 40,
          marginY = 40,
        } = options;

        const totalPages = pages.length;

        for (let i = 0; i < totalPages; i++) {
          const pageNumber = i + startNumber;

          if (excludePages.includes(i + 1)) continue;

          const page = pages[i];
          const { width, height } = page.getSize();

          const text = format
            .replace('{page}', pageNumber.toString())
            .replace('{total}', totalPages.toString());

          const textWidth = font.widthOfTextAtSize(text, fontSize);

          let x: number, y: number;

          if (position.includes('left')) {
            x = marginX;
          } else if (position.includes('center')) {
            x = (width - textWidth) / 2;
          } else {
            x = width - textWidth - marginX;
          }

          if (position.includes('header')) {
            y = height - marginY;
          } else {
            y = marginY;
          }

          page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(color.r, color.g, color.b),
          });
        }

        resultPDF = await pdfDoc.save();
        pageCount = totalPages;
        break;
      }

      case 'delete': {
        const pathToUse = (filePaths && filePaths[0]) || (files && files[0]);
        if (!pathToUse) throw new Error('No file provided for delete operation');

        let arrayBuffer: ArrayBuffer;

        if (pathToUse.startsWith('http')) {
          const response = await fetch(pathToUse);
          arrayBuffer = await response.arrayBuffer();
        } else {
          const { data, error } = await supabaseClient.storage
            .from('processed-pdfs')
            .download(pathToUse);
          if (error || !data) throw error;
          arrayBuffer = await data.arrayBuffer();
        }

        const sourcePdf = await PDFDocument.load(arrayBuffer);
        const totalPages = sourcePdf.getPageCount();
        const newPdf = await PDFDocument.create();

        const { pages: pageNumbers } = options;

        const pagesToKeep = Array.from(
          { length: totalPages },
          (_, i) => i
        ).filter((i) => !pageNumbers.includes(i + 1));

        const copiedPages = await newPdf.copyPages(sourcePdf, pagesToKeep);
        copiedPages.forEach((page) => newPdf.addPage(page));

        resultPDF = await newPdf.save();
        pageCount = copiedPages.length;
        break;
      }

      case 'extract': {
        const pathToUse = (filePaths && filePaths[0]) || (files && files[0]);
        if (!pathToUse) throw new Error('No file provided for extract operation');

        let arrayBuffer: ArrayBuffer;

        if (pathToUse.startsWith('http')) {
          const response = await fetch(pathToUse);
          arrayBuffer = await response.arrayBuffer();
        } else {
          const { data, error } = await supabaseClient.storage
            .from('processed-pdfs')
            .download(pathToUse);
          if (error || !data) throw error;
          arrayBuffer = await data.arrayBuffer();
        }

        const sourcePdf = await PDFDocument.load(arrayBuffer);
        const newPdf = await PDFDocument.create();

        const { pages: pageNumbers } = options;

        const pagesToExtract = pageNumbers.map((p: number) => p - 1);
        const copiedPages = await newPdf.copyPages(sourcePdf, pagesToExtract);
        copiedPages.forEach((page) => newPdf.addPage(page));

        resultPDF = await newPdf.save();
        pageCount = copiedPages.length;
        break;
      }

      case 'header_footer': {
        const pathToUse = (filePaths && filePaths[0]) || (files && files[0]);
        if (!pathToUse) throw new Error('No file provided for header/footer operation');

        let arrayBuffer: ArrayBuffer;

        if (pathToUse.startsWith('http')) {
          const response = await fetch(pathToUse);
          arrayBuffer = await response.arrayBuffer();
        } else {
          const { data, error } = await supabaseClient.storage
            .from('processed-pdfs')
            .download(pathToUse);
          if (error || !data) throw error;
          arrayBuffer = await data.arrayBuffer();
        }

        const pdfDoc = await PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const {
          headerText = '',
          footerText = '',
          fontSize = 10,
          color = { r: 0, g: 0, b: 0 },
          excludePages = [],
          marginX = 40,
          marginY = 40,
          fileName = '',
        } = options as HeaderFooterOptions;

        const totalPages = pages.length;

        for (let i = 0; i < totalPages; i++) {
          if (excludePages.includes(i + 1)) continue;

          const page = pages[i];
          const { width, height } = page.getSize();

          if (headerText) {
            const processedHeader = headerText
              .replace('{page}', (i + 1).toString())
              .replace('{total}', totalPages.toString())
              .replace('{file}', fileName)
              .replace('{date}', new Date().toLocaleDateString());

            const textWidth = font.widthOfTextAtSize(processedHeader, fontSize);
            const x = (width - textWidth) / 2;
            const y = height - marginY;

            page.drawText(processedHeader, {
              x,
              y,
              size: fontSize,
              font,
              color: rgb(color.r, color.g, color.b),
            });
          }

          if (footerText) {
            const processedFooter = footerText
              .replace('{page}', (i + 1).toString())
              .replace('{total}', totalPages.toString())
              .replace('{file}', fileName)
              .replace('{date}', new Date().toLocaleDateString());

            const textWidth = font.widthOfTextAtSize(processedFooter, fontSize);
            const x = (width - textWidth) / 2;
            const y = marginY;

            page.drawText(processedFooter, {
              x,
              y,
              size: fontSize,
              font,
              color: rgb(color.r, color.g, color.b),
            });
          }
        }

        resultPDF = await pdfDoc.save();
        pageCount = totalPages;
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unsupported operation" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }

    const fileName = `${crypto.randomUUID()}.pdf`;
    const fileSizeMB = resultPDF.length / (1024 * 1024);

    const { error: uploadError } = await supabaseClient.storage
      .from("processed-pdfs")
      .upload(fileName, resultPDF, {
        contentType: "application/pdf",
        cacheControl: "3600",
      });

    if (uploadError) {
      throw uploadError;
    }

    await supabaseClient.from("usage_logs").insert({
      user_id: user.id,
      operation,
      file_size_mb: parseFloat(fileSizeMB.toFixed(2)),
      page_count: pageCount,
    });

    const { data: urlData } = supabaseClient.storage
      .from("processed-pdfs")
      .getPublicUrl(fileName);

    return new Response(
      JSON.stringify({
        success: true,
        fileId: fileName,
        downloadUrl: urlData.publicUrl,
        pageCount,
        fileSize: resultPDF.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("PDF processing error:", error);

    return new Response(
      JSON.stringify({
        error: "PDF processing failed",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
