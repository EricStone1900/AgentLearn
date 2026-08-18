export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
}

export interface SearchPayload {
  backend: string;
  results: SearchResultItem[];
  answer?: string;
}

export interface SearchBackend {
  readonly name: string;
  readonly available: boolean;

  search(query: string, maxResults: number): Promise<SearchPayload>;
}
