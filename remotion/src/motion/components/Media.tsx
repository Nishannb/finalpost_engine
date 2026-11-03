import React from 'react';
import {Img} from 'remotion';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Award,
  BadgeCheck,
  Bell,
  Book,
  Bot,
  Brain,
  Briefcase,
  Building,
  Calendar,
  Camera,
  Car,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Cloud,
  Code,
  Coffee,
  Cpu,
  CreditCard,
  Crown,
  Database,
  DollarSign,
  Download,
  Eye,
  FileText,
  Film,
  Flame,
  Gauge,
  Gift,
  Globe,
  GraduationCap,
  Handshake,
  Hash,
  Heart,
  House,
  Image,
  Info,
  Laptop,
  Layers,
  Leaf,
  Lightbulb,
  Link,
  Lock,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Mic,
  Minus,
  Monitor,
  Moon,
  Music,
  Package,
  Pause,
  Percent,
  Plane,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Rocket,
  Scissors,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Sun,
  Target,
  ThumbsUp,
  Timer,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Truck,
  Upload,
  User,
  Users,
  Video,
  Wallet,
  Wand,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import {useMotionTheme} from '../context';
import {resolveMediaSrc} from '../../lib/mediaSrc';

/** Curated Lucide (ISC) icons, bundled — no network. Names are kebab-case. */
const ICONS = {
  'arrow-down': ArrowDown,
  'arrow-left-right': ArrowLeftRight,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-up-right': ArrowUpRight,
  award: Award,
  'badge-check': BadgeCheck,
  bell: Bell,
  book: Book,
  bot: Bot,
  brain: Brain,
  briefcase: Briefcase,
  building: Building,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  'chart-bar': ChartBar,
  'chart-column': ChartColumn,
  'chart-line': ChartLine,
  'chart-pie': ChartPie,
  check: Check,
  'circle-check': CircleCheck,
  'circle-x': CircleX,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  coffee: Coffee,
  cpu: Cpu,
  'credit-card': CreditCard,
  crown: Crown,
  database: Database,
  dollar: DollarSign,
  download: Download,
  eye: Eye,
  'file-text': FileText,
  film: Film,
  flame: Flame,
  gauge: Gauge,
  gift: Gift,
  globe: Globe,
  'graduation-cap': GraduationCap,
  handshake: Handshake,
  hash: Hash,
  heart: Heart,
  home: House,
  image: Image,
  info: Info,
  laptop: Laptop,
  layers: Layers,
  leaf: Leaf,
  lightbulb: Lightbulb,
  link: Link,
  lock: Lock,
  mail: Mail,
  'map-pin': MapPin,
  megaphone: Megaphone,
  message: MessageCircle,
  mic: Mic,
  minus: Minus,
  monitor: Monitor,
  moon: Moon,
  music: Music,
  package: Package,
  pause: Pause,
  percent: Percent,
  plane: Plane,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  repeat: Repeat,
  rocket: Rocket,
  scissors: Scissors,
  search: Search,
  server: Server,
  settings: Settings,
  share: Share2,
  shield: Shield,
  'shopping-cart': ShoppingCart,
  smartphone: Smartphone,
  sparkles: Sparkles,
  star: Star,
  store: Store,
  sun: Sun,
  target: Target,
  'thumbs-up': ThumbsUp,
  timer: Timer,
  'trending-down': TrendingDown,
  'trending-up': TrendingUp,
  trophy: Trophy,
  truck: Truck,
  upload: Upload,
  user: User,
  users: Users,
  video: Video,
  wallet: Wallet,
  wand: Wand,
  warning: TriangleAlert,
  x: X,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export type IconProps = {
  name: IconName;
  size: number;
  color?: string;
  /** Stroke width in the icon's 24-unit grid. Default 2. */
  strokeWidth?: number;
  style?: React.CSSProperties;
};

/** Outline icon from the curated set. Unknown names render a neutral dot instead of failing. */
export const Icon: React.FC<IconProps> = ({name, size, color, strokeWidth = 2, style}) => {
  const theme = useMotionTheme();
  const Component = (ICONS as Record<string, LucideIcon>)[name];
  if (!Component) {
    return <div style={{width: size, height: size, borderRadius: size / 2, background: color ?? theme.mutedText, ...style}} />;
  }
  return <Component size={size} color={color ?? theme.text} strokeWidth={strokeWidth} absoluteStrokeWidth={false} style={{display: 'block', ...style}} />;
};

export type AssetImageProps = {
  /** An asset `src` from props.assets (user logo, screenshot). Never a hard-coded URL. */
  src: string;
  width: number;
  height: number;
  fit?: 'cover' | 'contain';
  radius?: number;
  style?: React.CSSProperties;
};

/** Shows a user-provided / local image asset (waits for it to load before the frame renders). */
export const AssetImage: React.FC<AssetImageProps> = ({src, width, height, fit = 'contain', radius = 0, style}) => (
  <Img
    src={resolveMediaSrc(src)}
    style={{width, height, objectFit: fit, borderRadius: radius, display: 'block', ...style}}
  />
);

export type DeviceFrameProps = {
  kind: 'phone' | 'browser';
  width: number;
  height: number;
  /** Frame colour. Default a dark bezel. */
  color?: string;
  /** Browser address-bar text. */
  url?: string;
  children?: React.ReactNode;
};

/** Simple CSS device frame; children render inside the screen area (it clips). */
export const DeviceFrame: React.FC<DeviceFrameProps> = ({kind, width, height, color = '#0F1222', url = '', children}) => {
  const theme = useMotionTheme();
  if (kind === 'phone') {
    const bezel = Math.max(8, width * 0.045);
    return (
      <div style={{width, height, boxSizing: 'border-box', padding: bezel, borderRadius: width * 0.14, background: color, boxShadow: '0 12px 30px rgba(0,0,0,0.35)'}}>
        <div style={{position: 'relative', width: '100%', height: '100%', borderRadius: width * 0.1, overflow: 'hidden', background: theme.surface}}>
          {children}
          <div style={{position: 'absolute', top: bezel * 0.6, left: '50%', width: width * 0.28, height: bezel * 1.6, marginLeft: -width * 0.14, borderRadius: bezel, background: color}} />
        </div>
      </div>
    );
  }
  const bar = Math.max(28, height * 0.08);
  return (
    <div style={{width, height, borderRadius: theme.radius * 0.6, overflow: 'hidden', background: color, boxShadow: '0 12px 30px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column'}}>
      <div style={{height: bar, display: 'flex', alignItems: 'center', gap: bar * 0.22, padding: `0 ${bar * 0.4}px`}}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map(c => (
          <div key={c} style={{width: bar * 0.3, height: bar * 0.3, borderRadius: '50%', background: c}} />
        ))}
        <div style={{flex: 1, marginLeft: bar * 0.3, height: bar * 0.56, borderRadius: bar * 0.28, background: 'rgba(255,255,255,0.08)', color: theme.mutedText, fontSize: bar * 0.32, display: 'flex', alignItems: 'center', paddingLeft: bar * 0.3, whiteSpace: 'pre', overflow: 'hidden'}}>
          {url}
        </div>
      </div>
      <div style={{position: 'relative', flex: 1, background: theme.surface, overflow: 'hidden'}}>{children}</div>
    </div>
  );
};
