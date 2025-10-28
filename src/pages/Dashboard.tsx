import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Pencil, Trash2, FileUp, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface Report {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  updated_at: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setReports(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load reports",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNewReport = () => {
    navigate("/editor");
  };

  const handleEdit = (reportId: string) => {
    navigate(`/editor/${reportId}`);
  };

  const handleDelete = async (reportId: string, reportTitle: string) => {
    try {
      const { error } = await supabase
        .from("reports")
        .delete()
        .eq("id", reportId);

      if (error) throw error;

      setReports(reports.filter((report) => report.id !== reportId));
      toast({
        title: "Report deleted",
        description: `${reportTitle} has been removed.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete report",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = async (report: Report) => {
    try {
      setLoading(true);
      
      // Create a copy of the report
      const { data, error } = await supabase
        .from("reports")
        .insert({
          title: `${report.title} (Copy)`,
          content: report.content,
          pdf_storage_path: (report as any).pdf_storage_path || null,
          pdf_url: (report as any).pdf_url || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Add to reports list
      if (data) {
        setReports([data as Report, ...reports]);
        toast({
          title: "Report duplicated",
          description: `Copy of ${report.title} has been created.`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to duplicate report",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (report: Report) => {
    try {
      const content = report.content || "";
      const element = document.createElement('div');
      element.innerHTML = `
        <div style="padding: 20px; font-family: Arial, sans-serif;">
          <h1>${report.title}</h1>
          ${content}
        </div>
      `;

      // Import html2pdf dynamically
      const html2pdf = (await import("html2pdf.js")).default;
      
      const opt = {
        margin: 1,
        filename: `${report.title}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const }
      };

      // Generate PDF as blob
      const pdfBlob = await html2pdf().set(opt).from(element).outputPdf('blob');
      
      // Create download link with native dialog
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.title}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download started",
        description: "Choose location to save your report.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to download report",
        variant: "destructive",
      });
    }
  };

  const handleUploadPDF = () => {
    pdfInputRef.current?.click();
  };

  const handlePDFFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast({
        title: "Invalid file type",
        description: "Please select a PDF file.",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      console.log("Starting PDF upload:", file.name);

      // Upload PDF to Supabase Storage
      const fileName = `${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("pdfs")
        .upload(fileName, file, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("pdfs")
        .getPublicUrl(fileName);

      // Create new report with PDF reference
      const { data, error } = await supabase
        .from("reports")
        .insert({
          title: file.name.replace(".pdf", ""),
          content: "",
          pdf_storage_path: fileName,
          pdf_url: urlData.publicUrl,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "PDF uploaded successfully",
        description: `${file.name} is ready to edit.`,
      });

      // Navigate to the editor
      if (data) {
        navigate(`/editor/${data.id}`);
      }
    } catch (error) {
      console.error("PDF upload error:", error);
      toast({
        title: "Error",
        description: `Failed to upload PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      if (e.target) e.target.value = "";
    }
  };

  const filteredReports = reports.filter((report) =>
    report.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen p-6 md:p-8 lg:p-12">
      <div className="max-w-6xl mx-auto animate-fade-in">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Report Editor Dashboard 
          </h1>
          <p className="text-muted-foreground text-lg">Manage your PDF reports with ease</p>
        </header>

        {/* Search and New Report */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
            <Input
              type="text"
              placeholder="Search reports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 bg-card shadow-soft border-border/50 focus:shadow-hover transition-all duration-300"
            />
          </div>
          <Button
            onClick={handleNewReport}
            size="lg"
            className="h-12 px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-soft hover:shadow-hover transition-all duration-300 hover:scale-105"
          >
            <Plus className="mr-2 h-5 w-5" />
            New Report
          </Button>
        </div>

        {/* Hidden file input */}
        <input
          ref={pdfInputRef}
          type="file"
          accept=".pdf"
          onChange={handlePDFFileChange}
          className="hidden"
        />

        {/* Recent Reports */}
        <section>
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
            Recent Reports
            <span className="text-sm font-normal text-muted-foreground">
              ({filteredReports.length})
            </span>
          </h2>

          {loading ? (
            <Card className="p-12 text-center shadow-soft bg-gradient-to-br from-card to-muted/30">
              <p className="text-muted-foreground text-lg">Loading reports...</p>
            </Card>
          ) : filteredReports.length === 0 ? (
            <Card className="p-12 text-center shadow-soft bg-gradient-to-br from-card to-muted/30">
              <p className="text-muted-foreground text-lg">
                {searchQuery ? "No reports found matching your search." : "No reports yet. Create your first one!"}
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredReports.map((report, index) => (
                <Card
                  key={report.id}
                  className="p-6 shadow-soft hover:shadow-hover transition-all duration-300 hover:scale-105 bg-gradient-to-br from-card to-muted/20 border-border/50 cursor-pointer group animate-scale-in"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-1 group-hover:text-primary transition-colors">
                        {report.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Edited {formatDistanceToNow(new Date(report.updated_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-border/30">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(report.id)}
                      className="hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicate(report);
                      }}
                      className="hover:bg-accent/10 hover:text-accent transition-colors"
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(report);
                      }}
                      className="hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(report.id, report.title)}
                      className="hover:bg-destructive/10 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
