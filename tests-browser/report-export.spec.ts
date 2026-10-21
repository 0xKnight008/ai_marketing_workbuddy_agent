import {test,expect} from '@playwright/test';
import {reportEvidenceCsv,reportMarkdown} from '../src/workspace/report-export';
test('report files retain real line breaks, quotes, multilingual evidence and neutralize formulas',()=>{
 const quote='=SUM(1,2) "中文"\nsegunda línea';const report={id:'report-1',title:'Title',template:'comment_insights',report:{summary:'Summary',demandRanking:[{demand:'Finding',citations:[{ref:'i1',snippet:quote}]}]}};
 const csv=reportEvidenceCsv(report);expect(csv).toContain('"\'=SUM(1,2) ""中文""\nsegunda línea"');expect(csv.charCodeAt(0)).toBe(0xfeff);expect(csv.endsWith('\r\n')).toBe(true);expect(reportMarkdown(report)).toContain('**demand:** Finding');expect(reportMarkdown(report)).toContain(quote.replaceAll("\n","\n> "));
});
