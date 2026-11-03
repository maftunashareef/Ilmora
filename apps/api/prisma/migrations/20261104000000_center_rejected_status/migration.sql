-- A registration the Super Admin turned down keeps its row (audit, the reason shown to the center) instead of being deleted.
ALTER TYPE "CenterStatus" ADD VALUE 'REJECTED';
