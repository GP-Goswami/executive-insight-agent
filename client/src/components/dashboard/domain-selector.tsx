import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Globe, Settings2 } from "lucide-react";
import { useDomain } from "@/hooks/use-domain";
import { Badge } from "@/components/ui/badge";

export function DomainSelector() {
  const { domain, setDomain } = useDomain();
  const [inputValue, setInputValue] = useState(domain);
  const [isOpen, setIsOpen] = useState(false);

  const handleSave = () => {
    const cleanDomain = inputValue.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    setDomain(cleanDomain);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2 border-white/10"
          data-testid="button-domain-selector"
        >
          <Globe className="h-4 w-4 text-cyan-400" />
          {domain ? (
            <span className="max-w-[150px] truncate">{domain}</span>
          ) : (
            <span className="text-muted-foreground">Set Domain</span>
          )}
          <Settings2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-white/10">
        <DialogHeader>
          <DialogTitle>Configure Domain</DialogTitle>
          <DialogDescription>
            Enter your website domain to fetch real SEMrush data for rankings, backlinks, and traffic metrics.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Domain</label>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="example.com"
              className="bg-muted/50 border-white/10"
              data-testid="input-domain"
            />
            <p className="text-xs text-muted-foreground">
              Enter without https:// (e.g., example.com)
            </p>
          </div>
          {domain && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Globe className="h-3 w-3" />
                Current: {domain}
              </Badge>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)} className="border-white/10">
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            className="gradient-cyan-purple text-white"
            data-testid="button-save-domain"
          >
            Save Domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
