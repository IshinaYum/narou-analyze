import axios, { AxiosRequestConfig, AxiosResponse, AxiosError  } from "axios";
import * as zlib from 'zlib';
import * as yaml from 'js-yaml';
import {promises as fs} from 'fs';

// なろうAPI呼び出しの間隔(ms)
const waitTime = 1000;
// 出力ファイル
const outFilename = '/tmp/narou/all.tsv';
// API取得結果保存用ディレクトリ
const outDir = '/tmp/narou/';

type NAROU ={
    ncode: string,
    userid:number,
    genre:number,
    general_firstup: Date,
    general_lastup: Date,
    noveltype:number,
    end: number,
    general_all_no:number,
    length: number,
    istensei: number,
    istenni: number,
    global_point: number,
    fav_novel_cnt: number,
    impression_cnt: number, // 感想数
    review_cnt: number,
    all_point: number,
    all_hyoka_cnt: number,
    allcount: number
}

type NarowResult = {
    count:number,
    lastUp:Date,
}

function dateFormat(date:Date):string {
    const y = date.getUTCFullYear();
    const M = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    return y + "-" + ('0' + M).slice(-2) + '-' + ('0' + d).slice(-2) + ' ' + ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
}

const _sleep = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));
const lastest = Date.parse('2000-01-01 00:00:00') / 1000;
const nowtime = (Date.now() / 1000).toString();

async function gunzip(buff:zlib.InputType):Promise<Buffer> {
    return new Promise((resolve, reject) => {
        zlib.gunzip(buff, (err, data) =>
        {
            if (err) return reject(err);
    
            resolve(data);
        });
    });
}

const textDecoder = new TextDecoder();
const ncodes:{ [key: string]: string; } = {};

function greatest(a:number, b:number):number {
    return a>b ? a: b;
}

async function requestNarou(index:number, offset:number, lastup:string, outFile:fs.FileHandle):Promise<NarowResult> {
    console.log('requestNarou: ' + index + ', ' + offset + ', '+ lastup);
    const options: AxiosRequestConfig = {
        url: `https://api.syosetu.com/novelapi/api/?gzip=5&out=yaml&of=n-u-g-gf-gl-nt-e-ga-l-its-iti-gp-f-imp-r-a-ah&lim=500&order=old&lastup=` + lastup + `-` + nowtime,
        method: "GET",
        responseType : 'arraybuffer'
    };
    if(offset>0) {
        options.url += "&st=" + offset;
    }

    // 戻り値用。

    const ret:NarowResult = {count:0, lastUp:new Date() };

    try{
        await fs.mkdir(outDir);
    }catch(ex) {
    }

    const intA = Math.floor(index / 200) * 200;
    const dirA = ('0000' + intA).slice(-4) + "-" + ('0000' + (intA + 199)).slice(-4) + '\\';
    try{
        await fs.mkdir(outDir + dirA);
    }catch(ex) {
    }

    try{
        // リクエスト発行
        const response = await axios(options);

        // 圧縮された状態でファイルに保存。
        await fs.writeFile(outDir + dirA + 'result-'+ index + '.gz', response.data, 'binary');
        // gzip解凍してyamlをオブジェクトに変換
        const yamlData = await gunzip(response.data);
        const data = yaml.load(textDecoder.decode(yamlData)) as NAROU[];

        ret.count = data.length - 1;    // 取得できたデータ行

        let maxLastUp = lastest;
        // TSVに出力（0行目は要らない）
        for(let i:number = 1; i<data.length; ++i) {
            // 最終更新は一覧の最大を取る。
            const xLastUp = data[i].general_lastup.getTime() / 1000;
            if(maxLastUp < xLastUp) {
                ret.lastUp = data[i].general_lastup;
                maxLastUp = xLastUp;
            }

            if(ncodes[data[i].ncode] == null) {
                ncodes[data[i].ncode] = data[i].ncode;
                await outFile.writeFile(
                    data[i].ncode + '\t' +
                    data[i].userid + '\t' +
                    data[i].genre + '\t' +
                    dateFormat(data[i].general_firstup) + '\t' +
                    dateFormat(data[i].general_lastup) + '\t' +
                    data[i].noveltype + '\t' +
                    data[i].end + '\t' +
                    data[i].general_all_no + '\t' +
                    data[i].length + '\t' +
                    data[i].istensei + '\t' +
                    data[i].istenni + '\t' +
                    data[i].global_point + '\t' +
                    data[i].fav_novel_cnt + '\t' +
                    data[i].impression_cnt + '\t' +
                    data[i].review_cnt + '\t' +
                    data[i].all_point + '\t' +
                    data[i].all_hyoka_cnt + '\n');
            }else{
                continue;
            }
        }
        console.log('==> allcount='+ret.count+", get-length="+ data.length + ', ' + ret.lastUp + ', ' + ret.lastUp.getTime());
    } catch(ex) {
        console.log(ex);
    }
    return ret;
}


(async () =>
    {
        let lastup = lastest;
        let idx:number = 0;

        while(idx < 18) {
            const fd = await fs.open(outFilename, idx==0?'w':'a');

            let ret = await requestNarou(idx, 0, lastup.toString(), fd);
            if(ret.count < 500) break;
            let nextup = ret.lastUp.getTime()/1000;
            await _sleep(waitTime);
            ++idx;

            ret = await requestNarou(idx, 501, lastup.toString(), fd);
            if(ret.count < 500) break;
            nextup = greatest(nextup, ret.lastUp.getTime()/1000);
            await _sleep(waitTime);
            ++idx;

            ret = await requestNarou(idx, 1001, lastup.toString(), fd);
            if(ret.count < 500) break;
            nextup = greatest(nextup, ret.lastUp.getTime()/1000);
            await _sleep(waitTime);
            ++idx;

            ret = await requestNarou(idx, 1501, lastup.toString(), fd);
            if(ret.count < 500) break;
            nextup = greatest(nextup, ret.lastUp.getTime()/1000);
            await _sleep(waitTime);
            ++idx;

            if(nextup <= lastup) {
                console.log('ordering error!!!!');
                break;
            }
            lastup = nextup - 3600*9; // UTCにするため、9時間引かなきゃならない

            await fd.close();
        }
        console.log('finished.');
    }
)();

