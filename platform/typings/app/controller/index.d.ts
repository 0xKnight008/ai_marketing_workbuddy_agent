// This file is created by egg-ts-helper@2.1.1
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportPlatform from '../../../app/controller/platform';

declare module 'egg' {
  interface IController {
    platform: ExportPlatform;
  }
}
