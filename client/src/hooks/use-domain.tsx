import { createContext, useContext, useState, useEffect } from "react";

interface DomainContextType {
  domain: string;
  setDomain: (domain: string) => void;
  ga4PropertyId: string;
  setGa4PropertyId: (propertyId: string) => void;
  gscSiteUrl: string;
  setGscSiteUrl: (siteUrl: string) => void;
}

const DomainContext = createContext<DomainContextType | undefined>(undefined);

interface DomainProviderProps {
  children: React.ReactNode;
}

export function DomainProvider({ children }: DomainProviderProps) {
  const [domain, setDomain] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dashboard-domain") || "";
    }
    return "";
  });

  const [ga4PropertyId, setGa4PropertyId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dashboard-ga4-property-id") || "";
    }
    return "";
  });

  const [gscSiteUrl, setGscSiteUrl] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dashboard-gsc-site-url") || "";
    }
    return "";
  });

  useEffect(() => {
    if (domain) {
      localStorage.setItem("dashboard-domain", domain);
    }
  }, [domain]);

  useEffect(() => {
    if (ga4PropertyId) {
      localStorage.setItem("dashboard-ga4-property-id", ga4PropertyId);
    } else {
      localStorage.removeItem("dashboard-ga4-property-id");
    }
  }, [ga4PropertyId]);

  useEffect(() => {
    if (gscSiteUrl) {
      localStorage.setItem("dashboard-gsc-site-url", gscSiteUrl);
    } else {
      localStorage.removeItem("dashboard-gsc-site-url");
    }
  }, [gscSiteUrl]);

  return (
    <DomainContext.Provider value={{ domain, setDomain, ga4PropertyId, setGa4PropertyId, gscSiteUrl, setGscSiteUrl }}>
      {children}
    </DomainContext.Provider>
  );
}

export function useDomain() {
  const context = useContext(DomainContext);
  if (context === undefined) {
    throw new Error("useDomain must be used within a DomainProvider");
  }
  return context;
}
