import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  uploadToMusicAi,
  cleanupCustomerVocal,
  masterCustomerVocal,
  separateAudioWithMusicAi,
} from '../../shared/musicAi.ts';
import {
  createSunoGenerationTask,
  pollSunoGeneration,
  createSunoStemTask,
  pollSunoStems,
} from '../../shared/suno.ts';
import { transcribeAudioUrl } from '../../shared/transcription.ts';
import { organizeLyricsWithLLM, generateMusicalPrompt } from '../../shared/organizeLyrics.ts';
import { alignAndMixTrackPair, create70sPreviewMp3 } from '../../shared/audioProcessor.ts';
import {
  getGoogleDriveAccessToken,
  ensureFolderHierarchy,
  createNextSequentialMusicSubfolder,
  uploadFileToDriveFolder,
} from '../../shared/googleDrive.ts';
import { extractPhone } from '../../shared/umblerTalk.ts';
