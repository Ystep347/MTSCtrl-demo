import {mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {crc32,deflateRawSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';

// ZIP32 with UTF-8 names and a fixed DOS date for reproducible build artifacts.
export function writeZip(destination,entries){
  const files=[],directory=[];
  let offset=0;
  for(const {name,bytes} of entries){
    const filename=Buffer.from(name),packed=deflateRawSync(bytes,{level:9});
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20,4);
    local.writeUInt16LE(0x0800,6);
    local.writeUInt16LE(8,8);
    local.writeUInt16LE(33,12); // 1980-01-01
    local.writeUInt32LE(crc32(bytes),14);
    local.writeUInt32LE(packed.length,18);
    local.writeUInt32LE(bytes.length,22);
    local.writeUInt16LE(filename.length,26);
    files.push(local,filename,packed);

    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20,4);
    local.copy(central,6,4,30);
    central.writeUInt32LE(offset,42);
    directory.push(central,filename);
    offset+=local.length+filename.length+packed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length,8);
  end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(central.length,12);
  end.writeUInt32LE(offset,16);
  mkdirSync(dirname(destination),{recursive:true});
  const temp=destination+'.'+randomUUID()+'.tmp';
  writeFileSync(temp,Buffer.concat([...files,central,end]));
  renameSync(temp,destination);
}
