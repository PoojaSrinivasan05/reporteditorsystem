import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { ArrowLeft, Save, Download, FileUp, Image as ImageIcon, Bold, Italic, Underline, List, AlignLeft, AlignCenter, AlignRight, Maximize2, Minimize2, Settings2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import html2pdf from "html2pdf.js";
import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { PDFViewer, Annotation } from "@/components/pdf/PDFViewer";
import { PDFEditor } from "@/components/pdf/PDFEditor";
import { PageEditor } from "@/components/pdf/PageEditor";
import { useAbbreviations } from "@/hooks/useAbbreviations";
import { AbbreviationPopup } from "@/components/AbbreviationPopup";
import { AbbreviationSettings } from "@/components/AbbreviationSettings";

// Configure PDF.js worker via workerPort (Vite)
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
const Editor = () => {
  const navigate = useNavigate();
  const {
    reportId
  } = useParams();
  const location = useLocation();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("Untitled Report");
  const [loading, setLoading] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<{
    [key: number]: string;
  }>({});
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeAnnotationTool, setActiveAnnotationTool] = useState<"highlight" | "comment" | "none">("none");
  const [highlightColor, setHighlightColor] = useState("#FFFF00");
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<'text' | 'pdf'>('text');
  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    italic: false,
    underline: false,
    fontSize: 16,
    justifyLeft: false,
    justifyCenter: false,
    justifyRight: false,
  });

  // Abbreviation system
  const { abbreviations, addAbbreviation, deleteAbbreviation, getAbbreviation } = useAbbreviations();
  const [showAbbreviationPopup, setShowAbbreviationPopup] = useState(false);
  const [showAbbreviationSettings, setShowAbbreviationSettings] = useState(false);
  const [pendingAbbreviation, setPendingAbbreviation] = useState<{
    code: string;
    text: string;
    range: Range;
  } | null>(null);

  // Track unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  
  // Zoom control
  const [zoom, setZoom] = useState(100);

  // If we navigated here with a blob URL from Dashboard, show the PDF preview
  useEffect(() => {
    const state = location.state as any;
    if (state?.pdfUrl) {
      setPdfUrl(state.pdfUrl);
      setShowPdfPreview(true);
      setActiveTab('pdf');
    }
  }, [location.state]);

  // Detect abbreviation codes
  const detectAbbreviation = (e: KeyboardEvent) => {
    // Only detect on space, enter, or tab
    if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Tab') return;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    // Only process if we're in a text node
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const textContent = textNode.textContent || '';
    const cursorPos = range.startOffset;
    
    // Get the word before cursor
    const textBeforeCursor = textContent.substring(0, cursorPos);
    const wordMatch = textBeforeCursor.match(/(\S+)$/);
    
    if (!wordMatch) return;
    
    const word = wordMatch[1];
    const abbreviationText = getAbbreviation(word);
    
    if (abbreviationText) {
      e.preventDefault();
      
      // Create a range for the word to replace
      const wordStartPos = cursorPos - word.length;
      const replaceRange = document.createRange();
      replaceRange.setStart(textNode, wordStartPos);
      replaceRange.setEnd(textNode, cursorPos);
      
      setPendingAbbreviation({
        code: word,
        text: abbreviationText,
        range: replaceRange,
      });
      setShowAbbreviationPopup(true);
    }
  };

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Check for abbreviation first (only in text editor mode)
    if (activeTab === 'text' && editorRef.current?.contains(e.target as Node)) {
      detectAbbreviation(e);
    }

    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Ctrl/Cmd + B for bold
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      executeCommand('bold');
    }
    // Ctrl/Cmd + I for italic
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      executeCommand('italic');
    }
    // Ctrl/Cmd + U for underline
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
      e.preventDefault();
      executeCommand('underline');
    }
    // Ctrl/Cmd + Shift + L for bullet list
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'l') {
      e.preventDefault();
      executeCommand('insertUnorderedList');
    }
    // Ctrl/Cmd + D to download
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      handleDownload();
    }
  }, [activeTab, abbreviations]);
  useEffect(() => {
    if (reportId) {
      loadReport();
    } else if (editorRef.current && !editorRef.current.innerHTML.trim()) {
      editorRef.current.innerHTML = "<p class='text-muted-foreground'>Start editing your report here...</p>";
    }

    // Add keyboard shortcuts
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reportId, handleKeyDown]);

  // Remove placeholder on focus or input
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const removePlaceholder = () => {
      const placeholder = editor.querySelector('.text-muted-foreground');
      if (placeholder && placeholder.textContent === 'Start editing your report here...') {
        editor.innerHTML = '<p><br></p>';
        // Place cursor at start
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(editor.firstChild || editor, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    };

    editor.addEventListener('focus', removePlaceholder);
    editor.addEventListener('input', removePlaceholder);

    return () => {
      editor.removeEventListener('focus', removePlaceholder);
      editor.removeEventListener('input', removePlaceholder);
    };
  }, []);
  const loadReport = async () => {
    if (!reportId) return;
    setLoading(true);
    try {
      const {
        data,
        error
      } = await supabase.from("reports").select("*").eq("id", reportId).single();
      if (error) throw error;
      if (data) {
        setTitle(data.title);

        // If report has PDF, show PDF editor
        const pdfUrlFromDb = (data as any).pdf_url;
        if (pdfUrlFromDb) {
          setPdfUrl(pdfUrlFromDb);
          setShowPdfPreview(true);
          setActiveTab('pdf');
        } else if (editorRef.current) {
          editorRef.current.innerHTML = data.content || "<p>Start editing your report here...</p>";
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load report",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };
  const updateActiveStyles = () => {
    if (!editorRef.current) return;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setActiveStyles({
        bold: false,
        italic: false,
        underline: false,
        fontSize: 16,
        justifyLeft: false,
        justifyCenter: false,
        justifyRight: false,
      });
      return;
    }

    const bold = document.queryCommandState('bold');
    const italic = document.queryCommandState('italic');
    const underline = document.queryCommandState('underline');
    const justifyLeft = document.queryCommandState('justifyLeft');
    const justifyCenter = document.queryCommandState('justifyCenter');
    const justifyRight = document.queryCommandState('justifyRight');
    
    // Get font size
    let fontSize = 16;
    const fontSizeValue = document.queryCommandValue('fontSize');
    if (fontSizeValue) {
      const sizeMap: { [key: string]: number } = {
        '1': 10, '2': 13, '3': 16, '4': 18, '5': 24, '6': 32, '7': 48
      };
      fontSize = sizeMap[fontSizeValue] || 16;
    }
    
    // Check for inline styles
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const parent = container.nodeType === 3 ? container.parentElement : container as HTMLElement;
    if (parent) {
      const computedStyle = window.getComputedStyle(parent);
      const pixelSize = parseInt(computedStyle.fontSize);
      if (pixelSize) fontSize = pixelSize;
    }

    setActiveStyles({
      bold,
      italic,
      underline,
      fontSize,
      justifyLeft,
      justifyCenter,
      justifyRight,
    });
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      updateActiveStyles();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    editorRef.current?.addEventListener('keyup', handleSelectionChange);
    editorRef.current?.addEventListener('mouseup', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      editorRef.current?.removeEventListener('keyup', handleSelectionChange);
      editorRef.current?.removeEventListener('mouseup', handleSelectionChange);
    };
  }, []);

  const executeCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setTimeout(updateActiveStyles, 10);
  };
  const handleFontSizeChange = (size: number) => {
    setFontSize(size);
    editorRef.current?.focus();
    document.execCommand("fontSize", false, "7");
    const fontElements = editorRef.current?.querySelectorAll("font[size='7']");
    fontElements?.forEach(element => {
      (element as HTMLElement).removeAttribute("size");
      (element as HTMLElement).style.fontSize = `${size}px`;
    });
    setTimeout(updateActiveStyles, 10);
  };
  const handleSave = async () => {
    if (!editorRef.current) return;
    setLoading(true);
    try {
      const content = editorRef.current.innerHTML;
      if (reportId) {
        // Update existing report
        const { 
          error
        } = await supabase.from("reports").update({
          title,
          content,
          updated_at: new Date().toISOString()
        }).eq("id", reportId);
        if (error) throw error;
      } else {
        // Create new report
        const {
          data,
          error
        } = await supabase.from("reports").insert({
          title,
          content
        }).select().single();
        if (error) throw error;

        // Navigate to the new report's edit page
        if (data) {
          navigate(`/editor/${data.id}`, {
            replace: true
          });
        }
      }
      setHasUnsavedChanges(false);
      toast({
        title: "Report saved",
        description: "Your changes have been saved successfully."
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save report",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePdfEdits = async () => {
    if (!reportId) {
      toast({
        title: "No report",
        description: "Create or open a report before saving.",
        variant: "destructive",
      });
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase
        .from("reports")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", reportId);
      if (error) throw error;
      setHasUnsavedChanges(false);
      toast({
        title: "Edits saved",
        description: "Your PDF edits have been saved to this report.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save edits",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };
  const handleDownload = async () => {
    const content = editorRef.current?.innerHTML || "";
    const element = document.createElement('div');
    element.innerHTML = `
      <div style="padding: 20px; font-family: Arial, sans-serif;">
        ${content}
      </div>
    `;
    const opt = {
      margin: 1,
      filename: `${title}.pdf`,
      image: {
        type: 'jpeg' as const,
        quality: 0.98
      },
      html2canvas: {
        scale: 2
      },
      jsPDF: {
        unit: 'in',
        format: 'letter',
        orientation: 'portrait' as const
      }
    };
    
    // Generate PDF as blob
    const pdfBlob = await html2pdf().set(opt).from(element).outputPdf('blob');
    
    // Create object URL and trigger download with native dialog
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: "Choose location to save your PDF report."
    });
  };
  const handleImportPDF = () => {
    fileInputRef.current?.click();
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast({
        title: "Invalid file type",
        description: "Please select a PDF file.",
        variant: "destructive"
      });
      return;
    }
    try {
      setLoading(true);
      console.log("Starting PDF import:", file.name, file.size);
      const arrayBuffer = await file.arrayBuffer();
      console.log("File loaded as array buffer");
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer
      });
      const pdf = await loadingTask.promise;
      console.log("PDF loaded successfully, pages:", pdf.numPages);

      // Create object URL for PDF preview
      const url = URL.createObjectURL(file);
      setPdfUrl(url);
      setShowPdfPreview(true);
      setActiveTab('text');
      const pages: {
        [key: number]: string;
      } = {};

      // Extract text from all pages with better formatting
      for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`Processing page ${i} of ${pdf.numPages}`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        // Better text extraction with positioning
        let pageHtml = `<div class="pdf-page" data-page="${i}"><h3>Page ${i}</h3>`;
        let lastY = 0;
        textContent.items.forEach((item: any) => {
          const text = item.str;
          const y = item.transform[5];

          // Add line breaks for new lines
          if (lastY !== 0 && Math.abs(y - lastY) > 5) {
            pageHtml += "<br/>";
          }
          pageHtml += `<span>${text} </span>`;
          lastY = y;
        });
        pageHtml += "</div>";
        pages[i] = pageHtml;
      }
      setPdfPages(pages);

      // Set first page in editor
      if (editorRef.current && pages[1]) {
        editorRef.current.innerHTML = pages[1];
      }
      setTitle(file.name.replace(".pdf", ""));
      toast({
        title: "PDF imported successfully",
        description: `${file.name} loaded with ${pdf.numPages} pages.`
      });
    } catch (error) {
      console.error("PDF import error:", error);
      toast({
        title: "Error",
        description: `Failed to import PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
      // Reset input
      if (e.target) e.target.value = "";
    }
  };
  const handleImageUpload = () => {
    imageInputRef.current?.click();
  };
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let successCount = 0;
    Array.from(files).forEach(file => {
      if (file.type === "image/jpeg" || file.type === "image/jpg" || file.type === "image/png" || file.type === "image/webp") {
        const reader = new FileReader();
        reader.onload = event => {
          const imageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const wrapper = `<div class="resizable-image-wrapper" data-image-id="${imageId}" contenteditable="false" style="display: inline-block; position: relative; max-width: 100%; margin: 1rem 0;">
            <img src="${event.target?.result}" style="max-width: 100%; height: auto; display: block; pointer-events: none;" draggable="false" />
            <div class="resize-handle nw" data-direction="nw" style="position: absolute; top: 0; left: 0; width: 12px; height: 12px; background: hsl(var(--primary)); border: 2px solid white; border-radius: 50%; cursor: nw-resize; z-index: 10;"></div>
            <div class="resize-handle ne" data-direction="ne" style="position: absolute; top: 0; right: 0; width: 12px; height: 12px; background: hsl(var(--primary)); border: 2px solid white; border-radius: 50%; cursor: ne-resize; z-index: 10;"></div>
            <div class="resize-handle sw" data-direction="sw" style="position: absolute; bottom: 0; left: 0; width: 12px; height: 12px; background: hsl(var(--primary)); border: 2px solid white; border-radius: 50%; cursor: sw-resize; z-index: 10;"></div>
            <div class="resize-handle se" data-direction="se" style="position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; background: hsl(var(--primary)); border: 2px solid white; border-radius: 50%; cursor: se-resize; z-index: 10;"></div>
          </div>`;
          document.execCommand("insertHTML", false, wrapper);
          
          // Setup resize handlers after insertion
          setTimeout(() => {
            const insertedWrapper = editorRef.current?.querySelector(`[data-image-id="${imageId}"]`) as HTMLElement;
            if (insertedWrapper) {
              setupImageInteractions(insertedWrapper);
            }
          }, 100);
          
          successCount++;
          if (successCount === files.length) {
            toast({
              title: "Images added",
              description: `${successCount} image${successCount > 1 ? "s" : ""} inserted successfully.`
            });
          }
        };
        reader.readAsDataURL(file);
      }
    });
    e.target.value = "";
  };

  const setupImageInteractions = (wrapper: HTMLElement) => {
    const img = wrapper.querySelector('img') as HTMLImageElement;
    if (!img) return;

    // Resizing functionality only (no dragging)
    const handles = wrapper.querySelectorAll('.resize-handle');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        const mouseEvent = e as MouseEvent;
        const direction = (handle as HTMLElement).dataset.direction;
        
        const startWidth = img.offsetWidth;
        const startHeight = img.offsetHeight;
        const startX = mouseEvent.clientX;
        const startY = mouseEvent.clientY;
        const aspectRatio = startWidth / startHeight;

        const handleMouseMove = (moveEvent: MouseEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const deltaY = moveEvent.clientY - startY;
          
          let newWidth = startWidth;
          let newHeight = startHeight;

          if (direction === 'se') {
            newWidth = Math.max(50, startWidth + deltaX);
            newHeight = newWidth / aspectRatio;
          } else if (direction === 'sw') {
            newWidth = Math.max(50, startWidth - deltaX);
            newHeight = newWidth / aspectRatio;
          } else if (direction === 'ne') {
            newWidth = Math.max(50, startWidth + deltaX);
            newHeight = newWidth / aspectRatio;
          } else if (direction === 'nw') {
            newWidth = Math.max(50, startWidth - deltaX);
            newHeight = newWidth / aspectRatio;
          }

          img.style.width = newWidth + 'px';
          img.style.height = newHeight + 'px';
        };

        const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      });
    });
  };

  // Setup interactions for existing images on load
  useEffect(() => {
    if (!editorRef.current) return;
    
    const wrappers = editorRef.current.querySelectorAll('.resizable-image-wrapper');
    wrappers.forEach((wrapper) => {
      setupImageInteractions(wrapper as HTMLElement);
    });
  }, []);
  const handlePageChange = (pageNum: number) => {
    setCurrentPdfPage(pageNum);
    if (pdfPages[pageNum] && editorRef.current) {
      editorRef.current.innerHTML = pdfPages[pageNum];
    }
  };
  const handlePageContentChange = (content: string, pageNum: number) => {
    setPdfPages(prev => ({
      ...prev,
      [pageNum]: content
    }));
  };
  const handleAddAnnotation = (annotation: Annotation) => {
    setAnnotations(prev => [...prev, annotation]);
    toast({
      title: "Annotation added",
      description: "Your highlight has been added."
    });
  };

  // Handle abbreviation confirmation
  const handleAbbreviationConfirm = () => {
    if (!pendingAbbreviation || !editorRef.current) return;

    const { text, range } = pendingAbbreviation;
    
    try {
      // Focus editor first
      editorRef.current.focus();
      
      // Delete the abbreviation code
      range.deleteContents();
      
      // Insert the expanded text with proper formatting (preserve line breaks)
      const textWithBreaks = text.replace(/\n/g, '<br>');
      const textNode = document.createTextNode('');
      range.insertNode(textNode);
      
      // Use insertHTML for better handling
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('insertHTML', false, textWithBreaks + ' ');
      }
      
      // Ensure editor stays focused
      editorRef.current.focus();
    } catch (error) {
      console.error('Error inserting abbreviation:', error);
    }
    
    setShowAbbreviationPopup(false);
    setPendingAbbreviation(null);
  };

  const handleAbbreviationCancel = () => {
    if (!pendingAbbreviation || !editorRef.current) return;

    try {
      // Focus editor first
      editorRef.current.focus();
      
      // Keep the abbreviation code and just add the space
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = pendingAbbreviation.range.cloneRange();
        range.collapse(false);
        selection.addRange(range);
        document.execCommand('insertHTML', false, ' ');
      }
      
      // Ensure editor stays focused
      editorRef.current.focus();
    } catch (error) {
      console.error('Error handling abbreviation cancel:', error);
    }

    setShowAbbreviationPopup(false);
    setPendingAbbreviation(null);
  };

  // Handle back navigation with unsaved changes check
  const handleBackClick = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      navigate("/");
    }
  };

  const handleConfirmLeave = () => {
    setShowUnsavedDialog(false);
    navigate("/");
  };

  // Track changes in editor
  useEffect(() => {
    const handleInput = () => {
      setHasUnsavedChanges(true);
    };

    const editor = editorRef.current;
    if (editor) {
      editor.addEventListener('input', handleInput);
      return () => {
        editor.removeEventListener('input', handleInput);
      };
    }
  }, []);

  // Track title changes
  useEffect(() => {
    if (title !== "Untitled Report") {
      setHasUnsavedChanges(true);
    }
  }, [title]);

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 10, 50));
  };

  const handleZoomReset = () => {
    setZoom(100);
  };
  return <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-background via-background to-muted/20">
      {/* Fixed Header */}
      <header className="flex-shrink-0 border-b bg-gradient-to-r from-card via-card to-card/95 backdrop-blur-md shadow-lg">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleBackClick} 
              className="hover:bg-primary/10 hover:text-primary transition-colors rounded-lg" 
              title="Back to Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="h-8 w-px bg-border/50" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              {reportId ? "Edit Report" : "New Report"}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowAbbreviationSettings(true)}
              className="hover:bg-primary/10 hover:text-primary transition-colors rounded-lg"
              title="Abbreviations"
            >
              <Settings2 className="h-4 w-4" />
              
            </Button>
           
          </div>
          
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleImportPDF} 
              className="shadow-soft hover:shadow-hover hover:border-primary/50 transition-all rounded-lg"
            >
              <FileUp className="h-4 w-4 mr-2" />
              Import PDF
            </Button>
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />
            
              <Button 
                variant="outline" 
                size="sm" 
                onClick={activeTab === 'pdf' ? handleSavePdfEdits : handleSave} 
                disabled={loading} 
                className="shadow-soft hover:shadow-hover hover:border-accent/50 transition-all rounded-lg"
              >
                <Save className="h-4 w-4 mr-2" />
                {loading ? "Saving..." : activeTab === 'pdf' ? "Save Edits" : "Save"}
              </Button>
              
              <Button 
                size="sm" 
                onClick={activeTab === 'pdf' ? () => (window as any).pdfEditorDownload?.() : handleDownload} 
                className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground shadow-soft hover:shadow-hover transition-all rounded-lg font-medium"
              >
                <Download className="h-4 w-4 mr-2" />
                {activeTab === 'pdf' ? "Download Edited PDF" : "Download"}
              </Button>
          </div>
        </div>

        {/* Title Input */}
        <div className="px-4 pb-4">
          <Input 
            type="text" 
            value={title} 
            onChange={e => setTitle(e.target.value)} 
            maxLength={100}
            className="w-full h-10 text-lg font-semibold bg-background/50 border-border/50 focus:border-primary transition-all" 
            placeholder="Report Title" 
          />
          <p className="text-xs text-muted-foreground mt-1">{title.length}/100 characters</p>
        </div>

        {pdfUrl && (
          <div className="px-4 pb-2">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'text' | 'pdf')}>
              <TabsList>
                <TabsTrigger value="text">Text Editor</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
 
        {/* Fixed Toolbar - Only show when NOT in PDF editor mode */}
        {activeTab === 'text' && <div className="px-4 pb-3">
            <div className="flex items-center gap-1 p-2 bg-muted/30 rounded-lg border border-border/30">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => executeCommand("bold")} 
                className={`h-8 w-8 p-0 ${activeStyles.bold ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/10 hover:text-primary'}`}
                title="Bold (Ctrl+B)"
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => executeCommand("italic")} 
                className={`h-8 w-8 p-0 ${activeStyles.italic ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/10 hover:text-primary'}`}
                title="Italic (Ctrl+I)"
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => executeCommand("underline")} 
                className={`h-8 w-8 p-0 ${activeStyles.underline ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/10 hover:text-primary'}`}
                title="Underline (Ctrl+U)"
              >
                <Underline className="h-4 w-4" />
              </Button>
              
              <div className="w-px h-6 bg-border mx-1" />
              
              <div className="flex items-center gap-2 px-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Size:</span>
                <input type="range" min="10" max="72" value={activeStyles.fontSize} onChange={e => handleFontSizeChange(Number(e.target.value))} className="w-24 h-2 bg-muted rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer" title={`Font Size: ${activeStyles.fontSize}px`} />
                <span className="text-xs font-medium text-foreground min-w-[2rem]">{activeStyles.fontSize}px</span>
              </div>
              
              <input type="color" onChange={e => executeCommand("foreColor", e.target.value)} className="h-8 w-8 rounded cursor-pointer border border-border/50 hover:border-primary/50 transition-colors" title="Text Color" />
              
              <div className="w-px h-6 bg-border mx-1" />
              
              <Button variant="ghost" size="sm" onClick={() => executeCommand("insertUnorderedList")} className="hover:bg-primary/10 hover:text-primary h-8 w-8 p-0" title="Bullet List (Ctrl+Shift+L)">
                <List className="h-4 w-4" />
              </Button>
              
              <div className="w-px h-6 bg-border mx-1" />
              
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => executeCommand("justifyLeft")} 
                className={`h-8 w-8 p-0 ${activeStyles.justifyLeft ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/10 hover:text-primary'}`}
                title="Align Left"
              >
                <AlignLeft className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => executeCommand("justifyCenter")} 
                className={`h-8 w-8 p-0 ${activeStyles.justifyCenter ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/10 hover:text-primary'}`}
                title="Align Center"
              >
                <AlignCenter className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => executeCommand("justifyRight")} 
                className={`h-8 w-8 p-0 ${activeStyles.justifyRight ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/10 hover:text-primary'}`}
                title="Align Right"
              >
                <AlignRight className="h-4 w-4" />
              </Button>
              
              <div className="w-px h-6 bg-border mx-1" />
              
              <Button variant="ghost" size="sm" onClick={handleImageUpload} className="hover:bg-accent/20 hover:text-accent h-8 w-8 p-0" title="Insert Image">
                <ImageIcon className="h-4 w-4" />
              </Button>
              <input ref={imageInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple onChange={handleImageChange} className="hidden" />

              <div className="w-px h-6 bg-border mx-1" />
              
              {/* Zoom Controls */}
              <div className="flex items-center gap-1 px-2">
                <Button variant="ghost" size="sm" onClick={handleZoomOut} disabled={zoom <= 50} className="h-8 w-8 p-0 hover:bg-primary/10" title="Zoom Out">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <button 
                  onClick={handleZoomReset}
                  className="text-xs font-medium text-foreground min-w-[3rem] hover:text-primary cursor-pointer px-2 py-1 rounded hover:bg-primary/10 transition-colors"
                  title="Reset zoom"
                >
                  {zoom}%
                </button>
                <Button variant="ghost" size="sm" onClick={handleZoomIn} disabled={zoom >= 200} className="h-8 w-8 p-0 hover:bg-primary/10" title="Zoom In">
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>

            </div>
          </div>}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex">
        {/* PDF Editor - Full height */}
        {activeTab === 'pdf' && pdfUrl && reportId ? <div className="w-full h-full">
            <PDFEditor pdfUrl={pdfUrl} reportId={reportId} onDownloadPDF={() => {}} />
          </div> : (/* Text Editor Panel - Only show when no PDF */
      <div className="w-full overflow-y-auto overflow-x-auto p-6">
            <div 
              className="mx-auto transition-transform duration-200 origin-top"
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center'
              }}
            >
              {/* A4 Page with visual page breaks */}
              <div 
                className="bg-card shadow-lg rounded-xl border border-border/30 mx-auto"
                style={{
                  width: '210mm',
                  minHeight: '297mm',
                  padding: '20mm',
                  position: 'relative',
                  backgroundImage: 'repeating-linear-gradient(transparent, transparent 277mm, hsl(var(--border)) 277mm, hsl(var(--border)) calc(277mm + 2px), transparent calc(277mm + 2px), transparent 297mm)',
                  backgroundSize: '100% 297mm',
                  backgroundPosition: '0 0',
                  marginBottom: `${(zoom / 100) * 20}px`
                }}
              >
                <div 
                  ref={editorRef} 
                  contentEditable 
                  suppressContentEditableWarning 
                  className="min-h-[257mm] focus:outline-none prose prose-slate max-w-none" 
                  style={{
                    caretColor: "hsl(180 65% 55%)",
                    lineHeight: "1.8"
                  }} 
                />
              </div>
            </div>
          </div>)}
      </div>

      {/* Abbreviation Popup */}
      {pendingAbbreviation && (
        <AbbreviationPopup
          isOpen={showAbbreviationPopup}
          code={pendingAbbreviation.code}
          text={pendingAbbreviation.text}
          onConfirm={handleAbbreviationConfirm}
          onCancel={handleAbbreviationCancel}
        />
      )}

      {/* Abbreviation Settings Dialog */}
      <AbbreviationSettings
        isOpen={showAbbreviationSettings}
        onClose={() => setShowAbbreviationSettings(false)}
        abbreviations={abbreviations}
        onAdd={addAbbreviation}
        onDelete={deleteAbbreviation}
      />

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to leave without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLeave}>
              Leave Without Saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>;
};
export default Editor;