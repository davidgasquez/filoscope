export type CollectionConfig = {
  name: string;
  context: string;
};

export type Collection = CollectionConfig & {
  materialize(destination: string): Promise<void>;
};

export type Area = {
  name: string;
  description: string;
  collections: readonly string[];
};

export type OkfFrontmatter = {
  type: string;
  title: string;
  context: string;
  resource: string;
  updated_at: string;
};

export type OkfDocument = {
  path: string;
  frontmatter: OkfFrontmatter;
  body: string;
};
