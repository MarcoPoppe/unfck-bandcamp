export interface BcAuthInfo {
  fanId: number;
  username: string;
  email: string | null;
}

export type BcItemType = 'a' | 't';

export interface BcCollectionItem {
  bcItemId: number;
  bcItemType: BcItemType;
  bcUrl: string;
  title: string;
  artistName: string | null;
  artistUrl: string | null;
  albumTitle: string | null;
  labelName: string | null;
  bandId: number | null;
  coverUrl: string | null;
  purchasedAt: string | null;
  rawJson: string;
}

export interface BcCollectionPage {
  items: BcCollectionItem[];
  lastToken: string | null;
  moreAvailable: boolean;
  collectionTotal: number | null;
}
